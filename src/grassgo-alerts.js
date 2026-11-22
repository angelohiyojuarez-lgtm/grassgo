// Sistema de Alertas y Modales con Diseño Neon GRASSGO
(function() {
  // Asegurar que el modal existe en el DOM
  function ensureModalDOM() {
    if (document.getElementById('grassgo-modal-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'grassgo-modal-overlay';
    overlay.className = 'fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-all duration-200 opacity-0 pointer-events-none select-none';
    overlay.innerHTML = `
      <div id="grassgo-modal-box" class="relative w-full max-w-sm rounded-2xl p-6 bg-[#0e161f] border border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.85)] transform scale-95 transition-all duration-200 flex flex-col items-center text-center">
        <!-- Resplandor ambiente de fondo -->
        <div id="modal-ambient-glow" class="absolute -top-10 -left-10 w-36 h-36 rounded-full bg-[#ccff00]/15 blur-2xl pointer-events-none"></div>
        <div class="absolute -bottom-10 -right-10 w-36 h-36 rounded-full bg-[#00f0ff]/10 blur-2xl pointer-events-none"></div>
        
        <!-- Icono con halo brillante -->
        <div id="modal-icon-badge" class="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-lg border border-white/10 relative z-10 bg-[#080d12]">
          <span id="modal-icon-symbol" class="material-symbols-outlined text-[32px] text-[#ccff00]">sports_soccer</span>
        </div>

        <!-- Título -->
        <h3 id="modal-header-title" class="font-headline-sm text-headline-sm font-extrabold text-white tracking-tight mb-2 relative z-10" style="font-family: 'Syne', sans-serif;">
          GRASSGO
        </h3>

        <!-- Mensaje formateado -->
        <div id="modal-body-content" class="text-sm text-slate-300 font-body-md relative z-10 whitespace-pre-line leading-relaxed mb-6 text-center w-full" style="font-family: 'Outfit', sans-serif;">
        </div>

        <!-- Input para Prompts (ej. Cambiar Contraseña) -->
        <div id="modal-input-wrapper" class="w-full mb-5 hidden relative z-10">
          <input id="modal-custom-input" type="text" class="w-full px-4 py-3 bg-[#080d12] border border-slate-700 focus:border-[#00f0ff] focus:ring-1 focus:ring-[#00f0ff] rounded-xl text-white text-sm outline-none transition" placeholder="">
        </div>

        <!-- Botones de Acción -->
        <div class="w-full flex items-center gap-3 relative z-10">
          <button id="modal-cancel-action" type="button" class="hidden flex-1 py-3 px-4 rounded-xl font-label-md font-bold text-slate-400 bg-white/5 hover:bg-white/10 active:scale-95 transition cursor-pointer">
            Cancelar
          </button>
          <button id="modal-confirm-action" type="button" class="flex-1 py-3.5 px-6 rounded-xl font-label-lg font-black uppercase tracking-wider bg-[#ccff00] hover:bg-[#d8ff33] text-black shadow-[0_0_24px_rgba(204,255,0,0.4)] active:scale-95 transition cursor-pointer" style="font-family: 'Outfit', sans-serif;">
            Entendido
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  let currentResolve = null;

  function showAlert({
    title = 'GRASSGO',
    message = '',
    type = 'info', // 'success', 'error', 'warning', 'info', 'booking'
    icon = '',
    confirmText = 'Entendido',
    cancelText = '',
    showInput = false,
    inputType = 'text',
    inputPlaceholder = '',
    inputValue = ''
  }) {
    ensureModalDOM();

    return new Promise((resolve) => {
      currentResolve = resolve;

      const overlay = document.getElementById('grassgo-modal-overlay');
      const box = document.getElementById('grassgo-modal-box');
      const titleEl = document.getElementById('modal-header-title');
      const msgEl = document.getElementById('modal-body-content');
      const iconSymbol = document.getElementById('modal-icon-symbol');
      const iconBadge = document.getElementById('modal-icon-badge');
      const ambientGlow = document.getElementById('modal-ambient-glow');
      const confirmBtn = document.getElementById('modal-confirm-action');
      const cancelBtn = document.getElementById('modal-cancel-action');
      const inputWrapper = document.getElementById('modal-input-wrapper');
      const inputEl = document.getElementById('modal-custom-input');

      // Configurar estilos según el tipo
      let iconName = icon;
      let iconColor = 'text-[#ccff00]';
      let glowColor = 'bg-[#ccff00]/15';
      let btnBg = 'bg-[#ccff00] hover:bg-[#d8ff33] text-black shadow-[0_0_24px_rgba(204,255,0,0.4)]';

      if (type === 'error') {
        iconName = iconName || 'error';
        iconColor = 'text-[#ff4d6d]';
        glowColor = 'bg-[#ff4d6d]/20';
        btnBg = 'bg-[#ff4d6d] hover:bg-[#ff3357] text-white shadow-[0_0_24px_rgba(255,77,109,0.4)]';
      } else if (type === 'success') {
        iconName = iconName || 'check_circle';
        iconColor = 'text-[#00ff88]';
        glowColor = 'bg-[#00ff88]/20';
        btnBg = 'bg-[#00ff88] hover:bg-[#26ff98] text-black shadow-[0_0_24px_rgba(0,255,136,0.4)]';
      } else if (type === 'warning') {
        iconName = iconName || 'warning';
        iconColor = 'text-[#ffb400]';
        glowColor = 'bg-[#ffb400]/20';
        btnBg = 'bg-[#ffb400] hover:bg-[#ffc229] text-black shadow-[0_0_24px_rgba(255,180,0,0.4)]';
      } else if (type === 'booking') {
        iconName = iconName || 'sports_soccer';
        iconColor = 'text-[#00f0ff]';
        glowColor = 'bg-[#00f0ff]/20';
        btnBg = 'bg-[#00f0ff] hover:bg-[#33f3ff] text-black shadow-[0_0_24px_rgba(0,240,255,0.4)]';
      } else {
        iconName = iconName || 'sports_soccer';
      }

      iconSymbol.textContent = iconName;
      iconSymbol.className = `material-symbols-outlined text-[32px] ${iconColor}`;
      ambientGlow.className = `absolute -top-10 -left-10 w-36 h-36 rounded-full ${glowColor} blur-2xl pointer-events-none`;
      confirmBtn.className = `flex-1 py-3.5 px-6 rounded-xl font-label-lg font-black uppercase tracking-wider ${btnBg} active:scale-95 transition cursor-pointer`;
      confirmBtn.textContent = confirmText;

      titleEl.textContent = title;
      msgEl.innerHTML = formatMessage(message);

      // Input
      if (showInput) {
        inputWrapper.classList.remove('hidden');
        inputEl.type = inputType;
        inputEl.placeholder = inputPlaceholder;
        inputEl.value = inputValue;
        setTimeout(() => inputEl.focus(), 150);
      } else {
        inputWrapper.classList.add('hidden');
      }

      // Cancel button
      if (cancelText) {
        cancelBtn.classList.remove('hidden');
        cancelBtn.textContent = cancelText;
      } else {
        cancelBtn.classList.add('hidden');
      }

      // Handlers
      function closeModal(value) {
        overlay.classList.remove('opacity-100');
        overlay.classList.add('opacity-0', 'pointer-events-none');
        box.classList.remove('scale-100');
        box.classList.add('scale-95');

        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
        overlay.onclick = null;

        if (currentResolve) {
          currentResolve(value);
          currentResolve = null;
        }
      }

      confirmBtn.onclick = () => {
        const val = showInput ? inputEl.value : true;
        closeModal(val);
      };

      cancelBtn.onclick = () => {
        closeModal(null);
      };

      overlay.onclick = (e) => {
        if (e.target === overlay) {
          closeModal(null);
        }
      };

      // Animación de entrada
      overlay.classList.remove('opacity-0', 'pointer-events-none');
      overlay.classList.add('opacity-100');
      box.classList.remove('scale-95');
      box.classList.add('scale-100');
    });
  }

  // Formateador de texto con viñetas destacadas
  function formatMessage(text) {
    if (!text) return '';
    return text.split('\n').map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('•')) {
        return `<div class="flex items-center gap-2 justify-center my-1 text-slate-200 font-semibold"><span class="w-1.5 h-1.5 rounded-full bg-[#ccff00] inline-block"></span><span>${trimmed.substring(1).trim()}</span></div>`;
      }
      return line;
    }).join('<br>');
  }

  // Interceptar window.alert nativo
  window.alert = function(msg) {
    const text = String(msg || '');
    let title = 'GRASSGO';
    let type = 'info';

    if (text.toLowerCase().includes('error') || text.toLowerCase().includes('falló') || text.toLowerCase().includes('incorrect')) {
      title = 'Aviso del Sistema';
      type = 'error';
    } else if (text.toLowerCase().includes('éxito') || text.toLowerCase().includes('confirmad') || text.toLowerCase().includes('actualizad') || text.toLowerCase().includes('cread')) {
      title = '¡Operación Exitosa!';
      type = 'success';
    } else if (text.toLowerCase().includes('reserva') || text.toLowerCase().includes('partido') || text.toLowerCase().includes('cancha')) {
      title = 'Estado de Cancha';
      type = 'booking';
    } else if (text.toLowerCase().includes('completa') || text.toLowerCase().includes('campo') || text.toLowerCase().includes('atención')) {
      title = 'Campos Requeridos';
      type = 'warning';
    }

    showAlert({
      title,
      message: text,
      type
    });
  };

  // Interceptar window.prompt nativo
  window.grassgoPrompt = function(title, placeholder = '', inputType = 'text') {
    return showAlert({
      title: title || 'Ingresa los Datos',
      message: '',
      type: 'info',
      icon: 'edit_square',
      showInput: true,
      inputType: inputType,
      inputPlaceholder: placeholder,
      confirmText: 'Aceptar',
      cancelText: 'Cancelar'
    });
  };

  // Exponer objeto GrassgoAlert global
  window.GrassgoAlert = {
    show: showAlert,
    success: (msg, title = '¡Todo Listo!') => showAlert({ title, message: msg, type: 'success' }),
    error: (msg, title = 'Error') => showAlert({ title, message: msg, type: 'error' }),
    warning: (msg, title = 'Atención') => showAlert({ title, message: msg, type: 'warning' }),
    info: (msg, title = 'Información') => showAlert({ title, message: msg, type: 'info' }),
    booking: (msg, title = 'Mis Reservas') => showAlert({ title, message: msg, type: 'booking' }),
    prompt: window.grassgoPrompt
  };

  // Inicializar apenas el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureModalDOM);
  } else {
    ensureModalDOM();
  }
})();
