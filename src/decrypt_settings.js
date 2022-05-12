const {createDecipheriv, scryptSync} = require('crypto');
const {CRYPT_SALT} = require('../config.js');

function make_key(password) {
    return scryptSync(password, CRYPT_SALT, 24);
}

function decrypt_settings(key, iv, encrypted) {
    const decipher = createDecipheriv('aes-192-cbc', key, iv);

    const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted,'hex')),decipher.final()]).toString();
    try {
        const data = JSON.parse(decrypted);
        return data;
    } catch(e) {
        throw(new Error("The encrypted settings data is not valid."));
    }
}

exports.make_key = make_key;
exports.decrypt_settings = decrypt_settings;
