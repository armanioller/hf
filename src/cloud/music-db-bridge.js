(function () {
  'use strict';

  var frame = document.getElementById('hfAppFrame');
  var DB_NAME = 'HalftoneForgeMusic';
  var DB_VERSION = 1;
  var STORE_NAME = 'tracks';
  var installedWindow = null;

  function openDb() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      try {
        var request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = function () {
          var db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          }
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { resolve(null); };
        request.onblocked = function () { resolve(null); };
      } catch (_) {
        resolve(null);
      }
    });
  }

  async function readAll() {
    var db = await openDb();
    if (!db) return [];
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var request = tx.objectStore(STORE_NAME).getAll();
        request.onsuccess = function () { resolve(Array.isArray(request.result) ? request.result : []); };
        request.onerror = function () { resolve([]); };
        tx.oncomplete = function () { try { db.close(); } catch (_) {} };
        tx.onerror = function () { try { db.close(); } catch (_) {} };
      } catch (_) {
        try { db.close(); } catch (_) {}
        resolve([]);
      }
    });
  }

  async function addRecord(record) {
    var db = await openDb();
    if (!db) throw new Error('IndexedDB indisponível para restaurar músicas.');
    return new Promise(function (resolve, reject) {
      try {
        var clean = {
          name: String(record && record.name || 'Faixa'),
          type: String(record && record.type || (record && record.blob && record.blob.type) || 'audio/mpeg'),
          blob: record && record.blob,
          addedAt: Number(record && record.addedAt) || Date.now()
        };
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var request = tx.objectStore(STORE_NAME).add(clean);
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { reject(request.error || new Error('Falha ao restaurar música.')); };
        tx.oncomplete = function () { try { db.close(); } catch (_) {} };
        tx.onerror = function () { try { db.close(); } catch (_) {} };
      } catch (error) {
        try { db.close(); } catch (_) {}
        reject(error);
      }
    });
  }

  async function clearRecords() {
    var db = await openDb();
    if (!db) return;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        var request = tx.objectStore(STORE_NAME).clear();
        request.onsuccess = request.onerror = function () { resolve(); };
        tx.oncomplete = function () { try { db.close(); } catch (_) {} };
        tx.onerror = function () { try { db.close(); } catch (_) {} };
      } catch (_) {
        try { db.close(); } catch (_) {}
        resolve();
      }
    });
  }

  function refreshPlayer(appWindow) {
    return new Promise(function (resolve) {
      resolve();
      setTimeout(function () {
        try { appWindow.location.reload(); } catch (_) {}
      }, 120);
    });
  }

  function install() {
    var appWindow;
    try { appWindow = frame && frame.contentWindow; } catch (_) { return; }
    if (!appWindow || installedWindow === appWindow) return;
    installedWindow = appWindow;

    appWindow.musicDbAll = readAll;
    appWindow.musicDbAdd = addRecord;
    appWindow.musicDbClear = clearRecords;
    appWindow.loadMusicLibrary = function () { return refreshPlayer(appWindow); };
    appWindow.HFMusicCloudBridge = {
      readAll: readAll,
      add: addRecord,
      clear: clearRecords
    };
  }

  if (frame) {
    frame.addEventListener('load', function () {
      installedWindow = null;
      setTimeout(install, 20);
      setTimeout(install, 300);
    });
    setTimeout(install, 400);
  }
})();
