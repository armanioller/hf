(function () {
  'use strict';

  var frame = document.getElementById('hfAppFrame');
  var initializedDocument = null;
  var doc = null;
  var win = null;
  var pendingMode = '';

  function injectStyles() {
    if (!doc || doc.getElementById('hfQuickStartStyle')) return;
    var style = doc.createElement('style');
    style.id = 'hfQuickStartStyle';
    style.textContent = [
      '.hf-quick-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;width:min(620px,88%);margin:18px auto 0}',
      '.hf-quick-card{min-height:82px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:6px;padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:11px;background:rgba(19,20,26,.84);color:var(--text);text-align:left;cursor:pointer;box-shadow:0 12px 30px rgba(0,0,0,.18)}',
      '.hf-quick-card:hover{border-color:rgba(255,71,19,.55);transform:translateY(-1px)}',
      '.hf-quick-card strong{font:700 10px/1.2 var(--font-mono);color:#fff}',
      '.hf-quick-card span{font:9.5px/1.4 var(--font-ui);color:var(--text-dim)}',
      '.hf-flow-overlay{position:fixed;inset:0;z-index:12500;display:grid;place-items:center;padding:18px;background:rgba(4,5,8,.8);backdrop-filter:blur(10px)}',
      '.hf-flow-overlay[hidden]{display:none!important}',
      '.hf-flow-card{width:min(760px,96vw);border:1px solid rgba(255,255,255,.12);border-radius:16px;background:linear-gradient(180deg,#202027,#15151a);box-shadow:0 28px 100px rgba(0,0,0,.7);overflow:hidden}',
      '.hf-flow-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--line)}',
      '.hf-flow-title{font:700 14px/1.2 var(--font-mono)}',
      '.hf-flow-sub{margin-top:4px;color:var(--text-dim);font-size:10px}',
      '.hf-flow-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:14px}',
      '.hf-flow-choice{min-height:150px;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;gap:12px;padding:15px;border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.025);cursor:pointer;text-align:left;color:var(--text)}',
      '.hf-flow-choice:hover{border-color:rgba(255,71,19,.55);background:rgba(255,71,19,.05)}',
      '.hf-flow-number{width:30px;height:30px;display:grid;place-items:center;border-radius:9px;background:rgba(255,71,19,.12);color:var(--accent);font:700 12px/1 var(--font-mono)}',
      '.hf-flow-choice strong{font:700 13px/1.2 var(--font-ui);color:#fff}',
      '.hf-flow-choice span{font:10px/1.5 var(--font-ui);color:var(--text-dim)}',
      '.hf-flow-foot{display:flex;justify-content:flex-end;padding:11px 14px;border-top:1px solid var(--line)}',
      '@media(max-width:700px){.hf-quick-actions,.hf-flow-grid{grid-template-columns:1fr}.hf-quick-actions{width:92%}.hf-flow-choice{min-height:110px}}'
    ].join('\n');
    doc.head.appendChild(style);
  }

  function chooseMode(mode, close) {
    if (close) close();
    var fileInput = doc.getElementById('fileInput');
    if (mode === 'mockup') {
      var mockup = doc.getElementById('btnMockup3D');
      if (mockup) mockup.click();
      return;
    }
    pendingMode = mode;
    if (fileInput) fileInput.click();
  }

  function injectEmptyActions() {
    var empty = doc && doc.getElementById('emptyState');
    if (!empty || doc.getElementById('hfQuickActions')) return;
    var wrap = doc.createElement('div');
    wrap.className = 'hf-quick-actions';
    wrap.id = 'hfQuickActions';
    wrap.innerHTML = '' +
      '<button class="hf-quick-card" type="button" data-hf-mode="halftone"><strong>CRIAR HALFTONE</strong><span>Carregue uma arte e ajuste trama, canais, ganho e acabamento.</span></button>' +
      '<button class="hf-quick-card" type="button" data-hf-mode="dtf"><strong>PREPARAR PARA DTF</strong><span>Abra a imagem e siga direto para tamanho, base branca e pré-impressão.</span></button>' +
      '<button class="hf-quick-card" type="button" data-hf-mode="mockup"><strong>CRIAR MOCKUP 3D</strong><span>Escolha um modelo padrão ou importe seu GLB e aplique a arte.</span></button>';
    empty.appendChild(wrap);
    wrap.addEventListener('click', function (event) {
      var button = event.target.closest('[data-hf-mode]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      chooseMode(button.dataset.hfMode);
    });
  }

  function injectFlowModal() {
    if (!doc || doc.getElementById('hfFlowOverlay')) return;
    var modal = doc.createElement('div');
    modal.className = 'hf-flow-overlay';
    modal.id = 'hfFlowOverlay';
    modal.hidden = true;
    modal.innerHTML = '' +
      '<div class="hf-flow-card" role="dialog" aria-modal="true" aria-labelledby="hfFlowTitle">' +
        '<div class="hf-flow-head"><div><div class="hf-flow-title" id="hfFlowTitle">ESCOLHA O FLUXO DE TRABALHO</div><div class="hf-flow-sub">O app abre somente as ferramentas necessárias para a próxima etapa.</div></div><button class="btn btn-ghost" id="btnHfFlowClose" type="button">Fechar</button></div>' +
        '<div class="hf-flow-grid">' +
          '<button class="hf-flow-choice" type="button" data-hf-mode="halftone"><span class="hf-flow-number">1</span><div><strong>Criar halftone</strong><span>Editor completo para trama, CMYK/RGB, tons, fundo e exportação.</span></div></button>' +
          '<button class="hf-flow-choice" type="button" data-hf-mode="dtf"><span class="hf-flow-number">2</span><div><strong>Preparar para DTF</strong><span>Carregue uma arte e avance para tamanho físico, base branca e verificação.</span></div></button>' +
          '<button class="hf-flow-choice" type="button" data-hf-mode="mockup"><span class="hf-flow-number">3</span><div><strong>Criar mockup 3D</strong><span>Abra o Studio 3D, escolha a peça e monte imagens para anúncios.</span></div></button>' +
        '</div>' +
        '<div class="hf-flow-foot"><button class="btn btn-ghost" id="btnHfFlowCancel" type="button">Cancelar</button></div>' +
      '</div>';
    doc.body.appendChild(modal);

    function close() { modal.hidden = true; }
    doc.getElementById('btnHfFlowClose').addEventListener('click', close);
    doc.getElementById('btnHfFlowCancel').addEventListener('click', close);
    modal.addEventListener('click', function (event) {
      var choice = event.target.closest('[data-hf-mode]');
      if (choice) {
        event.preventDefault();
        chooseMode(choice.dataset.hfMode, close);
      } else if (event.target === modal) close();
    });

    var upload = doc.getElementById('btnUpload');
    if (upload && !doc.getElementById('btnHfFlows')) {
      var button = doc.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-ghost';
      button.id = 'btnHfFlows';
      button.textContent = 'Fluxos';
      upload.parentNode.insertBefore(button, upload);
      button.addEventListener('click', function () { modal.hidden = false; });
    }
  }

  function imageIsReady() {
    var empty = doc.getElementById('emptyState');
    var canvas = doc.getElementById('previewCanvas');
    var removeBg = doc.getElementById('btnRemoveBg');
    var emptyHidden = !!empty && (empty.style.display === 'none' || getComputedStyle(empty).display === 'none');
    return emptyHidden && canvas && canvas.width > 1 && canvas.height > 1 && (!removeBg || removeBg.disabled === false);
  }

  function sendFileToDtf(file) {
    var dtfInput = doc.getElementById('dtfFilesInput');
    if (!dtfInput || !file) return false;
    try {
      var transfer = new DataTransfer();
      transfer.items.add(file);
      dtfInput.files = transfer.files;
      dtfInput.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (_) {
      return false;
    }
  }

  function openDtfWithFile(file) {
    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      if (imageIsReady()) {
        clearInterval(timer);
        var button = doc.getElementById('btnDtfBuilder');
        if (!button) return;
        button.click();
        setTimeout(function () {
          if (!sendFileToDtf(file)) {
            var addCurrent = doc.getElementById('btnDtfAddCurrent');
            if (addCurrent) addCurrent.click();
          }
        }, 180);
      } else if (attempts >= 80) {
        clearInterval(timer);
        var status = doc.getElementById('statusText');
        if (status) {
          status.textContent = 'A imagem não terminou de carregar. Tente novamente.';
          status.classList.add('error');
        }
      }
    }, 150);
  }

  function installFileRouting() {
    var fileInput = doc && doc.getElementById('fileInput');
    if (!fileInput || fileInput.dataset.hfFlowRouting === '1') return;
    fileInput.dataset.hfFlowRouting = '1';
    fileInput.addEventListener('change', function () {
      var mode = pendingMode;
      pendingMode = '';
      var selectedFile = fileInput.files && fileInput.files[0];
      if (!selectedFile || !mode || mode === 'halftone') return;
      if (mode === 'dtf') openDtfWithFile(selectedFile);
    }, true);
  }

  function updateDocumentation() {
    if (!doc || doc.getElementById('docs-fluxos')) return;
    var content = doc.getElementById('docsContent');
    if (!content) return;
    var section = doc.createElement('section');
    section.id = 'docs-fluxos';
    section.innerHTML = '' +
      '<h2>Fluxos de trabalho</h2>' +
      '<p>Na tela vazia e no botão <code>Fluxos</code>, escolha entre criar halftone, preparar uma arte para DTF ou abrir o Mockup 3D.</p>' +
      '<ul><li><strong>Criar halftone:</strong> abre a imagem no editor principal.</li><li><strong>Preparar para DTF:</strong> carrega a imagem, adiciona o arquivo ao projeto DTF e abre automaticamente a preparação.</li><li><strong>Criar mockup 3D:</strong> abre o Studio 3D sem exigir uma imagem no editor.</li></ul>';
    var first = content.querySelector('section');
    if (first && first.nextSibling) content.insertBefore(section, first.nextSibling);
    else content.appendChild(section);
  }

  function initialize() {
    try {
      win = frame && frame.contentWindow;
      doc = frame && frame.contentDocument;
    } catch (_) {
      win = null;
      doc = null;
    }
    if (!doc) return;
    if (initializedDocument !== doc) {
      initializedDocument = doc;
      injectStyles();
    }
    injectEmptyActions();
    injectFlowModal();
    installFileRouting();
    updateDocumentation();
  }

  if (frame) {
    frame.addEventListener('load', function () {
      setTimeout(initialize, 150);
      setTimeout(initialize, 900);
      setTimeout(initialize, 2200);
    });
    setTimeout(initialize, 600);
  }
})();
