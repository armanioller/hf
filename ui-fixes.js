(function () {
  'use strict';

  var frame = document.getElementById('hfAppFrame');

  function install() {
    var doc;
    try { doc = frame && frame.contentDocument; } catch (_) { return; }
    if (!doc || doc.getElementById('hfUiFixesStyle')) return;

    var style = doc.createElement('style');
    style.id = 'hfUiFixesStyle';
    style.textContent = [
      '#appDialogOverlay { z-index: 12000 !important; }',
      '#appDialogOverlay .app-dialog-card { position: relative; z-index: 12001 !important; }',
      '.toast-stack { z-index: 12020 !important; }'
    ].join('\n');
    doc.head.appendChild(style);
  }

  if (frame) {
    frame.addEventListener('load', function () {
      setTimeout(install, 100);
      setTimeout(install, 900);
    });
    setTimeout(install, 500);
  }
})();