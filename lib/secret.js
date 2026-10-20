import Secret from 'gi://Secret';

const schema = new Secret.Schema('org.gnome.shell.extensions.rational-weather',
    Secret.SchemaFlags.NONE, {account: Secret.SchemaAttributeType.STRING});
const attributes = {account: 'amap-web-service'};

export function lookupKey(cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_lookup(schema, attributes, cancellable, (_source, result) => {
            try { resolve(Secret.password_lookup_finish(result)); } catch {
                reject(new Error('无法读取 GNOME 密钥环，请先解锁密钥环'));
            }
        });
    });
}

export function storeKey(key, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_store(schema, attributes, Secret.COLLECTION_DEFAULT,
            '知云天气 · 高德 Web 服务 Key', key, cancellable, (_source, result) => {
                try { resolve(Secret.password_store_finish(result)); } catch {
                    reject(new Error('无法保存到 GNOME 密钥环，请检查密钥环是否已解锁'));
                }
            });
    });
}

export function clearKey(cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_clear(schema, attributes, cancellable, (_source, result) => {
            try { resolve(Secret.password_clear_finish(result)); } catch {
                reject(new Error('无法删除密钥环中的 Key'));
            }
        });
    });
}
