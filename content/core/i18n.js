const getMessage = (key) => {
    if (typeof chrome !== 'undefined' && chrome.i18n) {
        return chrome.i18n.getMessage(key);
    } else if (typeof browser !== 'undefined' && browser.i18n) {
        return browser.i18n.getMessage(key);
    } else {
        return key;
    }
};

window.addEventListener("load", () => {
    document.querySelectorAll('[data-i18n]').forEach((e) => {
        e.innerHTML = getMessage(e.getAttribute('data-i18n'));
    });
});