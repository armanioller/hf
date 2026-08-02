(function () {
  'use strict';
  var originalGetItem = Storage.prototype.getItem;
  var resolving = false;

  Storage.prototype.getItem = function (key) {
    if (key === 'halftoneForgeGallery' && !resolving) {
      try {
        var frame = document.getElementById('hfAppFrame');
        var appWindow = frame && frame.contentWindow;
        var raw = originalGetItem.call(this, key);
        if (appWindow && Array.isArray(appWindow.galleryMemory) && appWindow.galleryMemory.length) {
          resolving = true;
          var memoryValue = JSON.stringify(appWindow.galleryMemory);
          resolving = false;
          return memoryValue;
        }
        return raw;
      } catch (_) {
        resolving = false;
      }
    }
    return originalGetItem.call(this, key);
  };
}());
