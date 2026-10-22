import Secret from 'gi://Secret';

const schema = new Secret.Schema('org.gnome.shell.extensions.rational-weather',
    Secret.SchemaFlags.NONE, {account: Secret.SchemaAttributeType.STRING});
const attributes = {account: 'amap-web-service'};

const SESSION_PATH = '/org/freedesktop/secrets/collection/session';

export class CredentialError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.safeMessage = message;
    }
}

function unavailable() {
    return new CredentialError('CREDENTIAL_UNAVAILABLE',
        '密钥环暂不可用，Key 不一定丢失。请解锁登录密钥环后重试');
}

function lockedError() {
    return new CredentialError('CREDENTIAL_LOCKED',
        '密钥环已锁定，Key 未丢失。请在“密码和密钥”中解锁后重试');
}

function sessionError() {
    return new CredentialError('CREDENTIAL_SESSION',
        '旧 Key 仅在会话密钥环中，请重新保存到持久密钥环，避免重启后丢失');
}

// Never include native error details: they may contain sensitive D-Bus data.
function invoke(start, finish) {
    return new Promise((resolve, reject) => {
        try {
            start((_object, result) => {
                try { resolve(finish(result)); } catch { reject(unavailable()); }
            });
        } catch { reject(unavailable()); }
    });
}

function getService(cancellable) {
    return invoke(callback => Secret.Service.get(Secret.ServiceFlags.OPEN_SESSION |
        Secret.ServiceFlags.LOAD_COLLECTIONS, cancellable, callback), Secret.Service.get_finish);
}

function forAlias(service, alias, cancellable) {
    return invoke(callback => Secret.Collection.for_alias(service, alias,
        Secret.CollectionFlags.NONE, cancellable, callback), Secret.Collection.for_alias_finish);
}

function persistent(collection) {
    return collection && collection.get_object_path() !== SESSION_PATH;
}

function belongsTo(item, collection) {
    return item.get_object_path().startsWith(`${collection.get_object_path()}/`);
}

function search(service, cancellable) {
    // Inspect locks before loading secrets; background lookups must not prompt.
    return invoke(callback => service.search(schema, attributes, Secret.SearchFlags.ALL,
        cancellable, callback), result => service.search_finish(result));
}

async function readItem(item, cancellable) {
    if (item.get_locked()) throw lockedError();
    await invoke(callback => item.load_secret(cancellable, callback),
        result => item.load_secret_finish(result));
    if (item.get_locked()) throw lockedError();
    const value = item.get_secret()?.get_text();
    if (!value) throw unavailable();
    return value;
}

export async function lookupKey(cancellable = null) {
    const service = await getService(cancellable);
    const items = await search(service, cancellable);
    const saved = items.filter(item => !item.get_object_path().startsWith(`${SESSION_PATH}/`));
    if (saved.length) {
        const preferred = await forAlias(service, Secret.COLLECTION_DEFAULT, cancellable);
        const matches = persistent(preferred) ? saved.filter(item => belongsTo(item, preferred)) : [];
        const choices = matches.length ? matches : saved;
        const item = choices.find(entry => !entry.get_locked());
        if (!item) throw lockedError();
        return readItem(item, cancellable);
    }
    if (items.length) throw sessionError();
    if (service.get_collections().some(collection => persistent(collection) && collection.get_locked()))
        throw lockedError();
    return null;
}

export async function storeKey(key, cancellable = null) {
    const service = await getService(cancellable);
    const preferred = await forAlias(service, Secret.COLLECTION_DEFAULT, cancellable);
    const collections = service.get_collections().filter(persistent);
    // The default alias may point to 'session'. Store using a verified path.
    let collection = persistent(preferred) ? preferred :
        collections.find(entry => entry.get_object_path().endsWith('/login')) ?? collections[0];
    if (!collection) {
        collection = await invoke(callback => Secret.Collection.create(service,
            '知云天气', null, Secret.CollectionFlags.NONE, cancellable, callback),
        Secret.Collection.create_finish);
    }
    if (!persistent(collection)) throw sessionError();
    if (collection.get_locked()) {
        await invoke(callback => service.unlock([collection], cancellable, callback),
            result => service.unlock_finish(result));
        if (collection.get_locked()) throw lockedError();
    }
    const value = Secret.Value.new(key, -1, 'text/plain');
    const stored = await invoke(callback => service.store(schema, attributes,
        collection.get_object_path(), '知云天气 · 高德 Web 服务 Key', value, cancellable, callback),
    result => service.store_finish(result));
    value.unref();
    if (!stored) throw new CredentialError('CREDENTIAL_SAVE_FAILED', '密钥环未保存 Key，请解锁后重试');
    const items = await search(service, cancellable);
    const item = items.find(entry => belongsTo(entry, collection));
    if (!item || await readItem(item, cancellable) !== key)
        throw new CredentialError('CREDENTIAL_SAVE_FAILED', 'Key 保存校验失败，请重新保存');
    return true;
}

export async function clearKey(cancellable = null) {
    await invoke(callback => Secret.password_clear(schema, attributes, cancellable, callback),
        Secret.password_clear_finish);
    return true;
}
