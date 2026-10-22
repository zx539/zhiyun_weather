// Run the production credential module against a controlled Secret Service.
// Never connect to the desktop's real keyring or use a real API credential.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const sourceFile = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('lib/secret.js');
const [, sourceBytes] = sourceFile.load_contents(null);
const directory = GLib.dir_make_tmp('zhiyun-credentials-test-XXXXXX');
const moduleFile = Gio.File.new_for_path(`${directory}/secret.mjs`);
const source = new TextDecoder().decode(sourceBytes).replace(
    "import Secret from 'gi://Secret';", 'const Secret = globalThis.__secretMock;');
moduleFile.replace_contents(new TextEncoder().encode(source), null, false, Gio.FileCreateFlags.PRIVATE, null);
const SESSION = '/org/freedesktop/secrets/collection/session';
const LOGIN = '/org/freedesktop/secrets/collection/login';
const DUMMY = 'dummy-weather-key-used-only-in-tests';
let alias, collections, items, failStore, locked, unavailable, calls;
function reset() {
    alias = SESSION; collections = [SESSION, LOGIN]; items = [];
    failStore = false; locked = false; unavailable = false; calls = [];
}
function collection(path) {
    return {get_object_path: () => path, get_locked: () => locked};
}
function item(path, value) {
    return {path, value, get_object_path: () => `${path}/item/test`, get_locked: () => locked,
        load_secret(_cancel, callback) { callback(this, {}); },
        load_secret_finish() { return true; },
        get_secret() { return {get_text: () => value}; }};
}
const service = {
    get_collections: () => collections.map(collection),
    search(_schema, _attributes, _flags, _cancel, callback) { callback(service, {}); },
    search_finish: () => items,
    unlock(objects, _cancel, callback) { locked = false; callback(service, objects); },
    unlock_finish: result => [result.length, result],
    store(_schema, _attrs, path, _label, value, _cancel, callback) {
        calls.push({operation: 'store', target: path});
        if (!failStore) items = [...items.filter(entry => entry.path !== path), item(path, value.get_text())];
        callback(service, {});
    },
    store_finish: () => !failStore,
};
globalThis.__secretMock = {
    Schema: class {}, SchemaFlags: {NONE: 0}, SchemaAttributeType: {STRING: 0},
    Value: class {
        constructor(text) { this.text = text; }
        get_text() { return this.text; }
        unref() {}
        static new(text) { return new this(text); }
    },
    COLLECTION_DEFAULT: 'default', COLLECTION_SESSION: 'session',
    ServiceFlags: {OPEN_SESSION: 2, LOAD_COLLECTIONS: 4},
    SearchFlags: {ALL: 2}, CollectionFlags: {NONE: 0},
    Service: {get(_flags, _cancel, callback) { callback(null, {}); },
        get_finish() { if (unavailable) throw new Error('service unavailable'); return service; }},
    Collection: {
        for_alias(_service, _alias, _flags, _cancel, callback) { callback(null, {}); },
        for_alias_finish: () => alias ? collection(alias) : null,
        create(_service, _label, _alias, _flags, _cancel, callback) {
            const path = '/org/freedesktop/secrets/collection/zhiyun';
            collections.push(path); callback(null, path);
        },
        create_finish: result => collection(result),
    },
    password_lookup(_schema, _attrs, _cancel, callback) { callback(null, {}); },
    password_lookup_finish: () => locked ? null : items[0]?.value ?? null,
    password_clear(_schema, _attrs, _cancel, callback) { items = []; callback(null, {}); },
    password_clear_finish: () => true,
};
function check(condition, message) { if (!condition) throw new Error(message); }
let failures = 0;
try {
    const credentials = await import(moduleFile.get_uri());
    const tests = [
        ['saved key survives loss of the session collection', async () => {
            await credentials.storeKey(DUMMY);
            items = items.filter(entry => entry.path !== SESSION); // logout/reboot
            check(await credentials.lookupKey() === DUMMY, 'API Key disappeared after session restart');
        }],
        ['locked stored key is not reported as unconfigured', async () => {
            alias = LOGIN; items = [item(LOGIN, DUMMY)]; locked = true;
            let error;
            try { await credentials.lookupKey(); } catch (caught) { error = caught; }
            check(error?.code === 'CREDENTIAL_LOCKED', 'locked keyring was treated as a missing API Key');
            locked = false;
            check(await credentials.lookupKey() === DUMMY, 'unlock did not recover existing key');
        }],
        ['failed save cannot report success', async () => {
            failStore = true;
            let rejected = false;
            try { await credentials.storeKey(DUMMY); } catch { rejected = true; }
            check(rejected, 'unsuccessful secret write was accepted as saved');
        }],
    ];
    for (const [name, run] of tests) {
        reset();
        try { await run(); print(`PASS ${name}`); } catch (error) {
            failures++; print(`FAIL ${name}: ${error.message}`);
        }
    }
} finally {
    delete globalThis.__secretMock;
    moduleFile.delete(null);
    Gio.File.new_for_path(directory).delete(null);
}
if (failures) throw new Error(`${failures} credential regression(s)`);
