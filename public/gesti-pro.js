/**
 * GestiFactu PRO Manager
 * Handles Freemium limits, paywall modals, Google Play Billing & Promo code activations.
 */

const GestiPro = (function() {
  const isAndroid = typeof window.AndroidBridge !== 'undefined';
  const LIMITS = {
    MAX_INVOICES_PER_MONTH: 5,
    MAX_BUDGETS_PER_MONTH: 5,
    MAX_DELIVERY_NOTES_PER_MONTH: 3,
    MAX_OCR_SCANS_PER_MONTH: 3
  };

  const PROMO_CODES = ["PRO2026", "GESTIFACTU-PRO", "AUTONOMO-VIP", "LIFETIME-PRO"];

  function isPro() {
    if (isAndroid && typeof window.AndroidBridge.isPro === 'function') {
      try {
        return window.AndroidBridge.isPro();
      } catch (e) {
        console.error("Error reading AndroidBridge.isPro:", e);
      }
    }
    return localStorage.getItem('gestifactu_pro_active') !== 'false';
  }

  function getProDetails() {
    if (isAndroid && typeof window.AndroidBridge.getProInfo === 'function') {
      try {
        return JSON.parse(window.AndroidBridge.getProInfo());
      } catch (e) {}
    }
    return {
      isPro: isPro(),
      planType: localStorage.getItem('gestifactu_pro_plan') || (isPro() ? 'lifetime_promo' : 'free'),
      activatedAt: localStorage.getItem('gestifactu_pro_date') || ''
    };
  }

  function getMonthlyUsage(invoicesList, budgetsList, deliveryNotesList) {
    const invoices = invoicesList || (window.APP_STATE ? window.APP_STATE.invoices : []) || [];
    const budgets = budgetsList || (window.APP_STATE ? window.APP_STATE.budgets : []) || [];
    const deliveryNotes = deliveryNotesList || (window.APP_STATE ? window.APP_STATE.deliveryNotes : []) || [];

    const now = new Date();
    const ym = now.toISOString().slice(0, 7); // e.g. "2026-10"

    const invoicesThisMonth = invoices.filter(i => (i.date || '').startsWith(ym)).length;
    const budgetsThisMonth = budgets.filter(b => (b.date || '').startsWith(ym)).length;
    const deliveryNotesThisMonth = deliveryNotes.filter(dn => (dn.date || '').startsWith(ym)).length;
    const ocrScansThisMonth = parseInt(localStorage.getItem('gestifactu_ocr_count_' + ym) || '0', 10);

    return {
      ym,
      invoicesThisMonth,
      budgetsThisMonth,
      deliveryNotesThisMonth,
      ocrScansThisMonth,
      maxInvoices: LIMITS.MAX_INVOICES_PER_MONTH,
      maxBudgets: LIMITS.MAX_BUDGETS_PER_MONTH,
      maxDeliveryNotes: LIMITS.MAX_DELIVERY_NOTES_PER_MONTH,
      maxOcrScans: LIMITS.MAX_OCR_SCANS_PER_MONTH,
      invoicesRemaining: Math.max(0, LIMITS.MAX_INVOICES_PER_MONTH - invoicesThisMonth),
      budgetsRemaining: Math.max(0, LIMITS.MAX_BUDGETS_PER_MONTH - budgetsThisMonth),
      deliveryNotesRemaining: Math.max(0, LIMITS.MAX_DELIVERY_NOTES_PER_MONTH - deliveryNotesThisMonth),
      ocrScansRemaining: Math.max(0, LIMITS.MAX_OCR_SCANS_PER_MONTH - ocrScansThisMonth)
    };
  }

  function recordOcrScan() {
    const ym = new Date().toISOString().slice(0, 7);
    const current = parseInt(localStorage.getItem('gestifactu_ocr_count_' + ym) || '0', 10);
    localStorage.setItem('gestifactu_ocr_count_' + ym, (current + 1).toString());
  }

  function openPaywall(reason) {
    const modal = document.getElementById('modal-pro-paywall');
    if (!modal) return;

    const titleEl = document.getElementById('pro-paywall-reason-title');
    const descEl = document.getElementById('pro-paywall-reason-desc');
    const usage = getMonthlyUsage();

    if (reason === 'invoice_limit') {
      if (titleEl) titleEl.textContent = "Has alcanzado el límite mensual de facturas";
      if (descEl) descEl.textContent = `Has emitido tus ${LIMITS.MAX_INVOICES_PER_MONTH} facturas gratuitas este mes. Pasa a GestiFactu PRO para emitir facturas ilimitadas de por vida.`;
    } else if (reason === 'budget_limit') {
      if (titleEl) titleEl.textContent = "Límite de presupuestos alcanzado";
      if (descEl) descEl.textContent = `Has alcanzado el cupo de ${LIMITS.MAX_BUDGETS_PER_MONTH} presupuestos este mes. Actualiza a PRO para enviar ofertas y presupuestos sin límite.`;
    } else if (reason === 'delivery_notes_limit') {
      if (titleEl) titleEl.textContent = "Límite de albaranes y partes de trabajo";
      if (descEl) descEl.textContent = `Has creado ${LIMITS.MAX_DELIVERY_NOTES_PER_MONTH} albaranes este mes en la versión gratuita. Pasa a PRO para gestionar albaranes y partes con firma ilimitados.`;
    } else if (reason === 'ocr_limit') {
      if (titleEl) titleEl.textContent = "Escaneos de tickets con IA agotados";
      if (descEl) descEl.textContent = `Has utilizado tus ${LIMITS.MAX_OCR_SCANS_PER_MONTH} lecturas OCR de tickets con cámara este mes. Pasa a PRO para escanear y auto-clasificar tickets sin límites.`;
    } else if (reason === 'logo') {
      if (titleEl) titleEl.textContent = "Logotipo propio y PDFs sin marcas";
      if (descEl) descEl.textContent = "Personaliza tus facturas, presupuestos y albaranes con el logotipo corporativo de tu empresa y elimina la marca de agua pasando a GestiFactu PRO.";
    } else if (reason === 'templates') {
      if (titleEl) titleEl.textContent = "Plantillas de diseño y colores corporativos";
      if (descEl) descEl.textContent = "Elige entre los 3 estilos de plantilla (Moderna, Ejecutiva, Tinta Ahorro) y los 5 colores corporativos de acento con GestiFactu PRO.";
    } else if (reason === 'recurring') {
      if (titleEl) titleEl.textContent = "Facturación recurrente y cuotas mensuales";
      if (descEl) descEl.textContent = "Automatiza tus cobros periódicos y genera en 1 solo clic todas las facturas del mes de tus clientes recurrentes con GestiFactu PRO.";
    } else if (reason === 'reports') {
      if (titleEl) titleEl.textContent = "Dossier oficial para tu Gestoría (PDF, ZIP y WhatsApp)";
      if (descEl) descEl.textContent = "La descarga del dossier contable en PDF, el paquete ZIP y el envío directo a tu asesor por WhatsApp con los Modelos 303 y 130 son exclusivos de GestiFactu PRO.";
    } else if (reason === 'csv_import') {
      if (titleEl) titleEl.textContent = "Importación masiva desde Excel / CSV";
      if (descEl) descEl.textContent = "Carga tu cartera completa de clientes o tu catálogo de tarifas en 2 segundos desde archivos Excel o CSV con GestiFactu PRO.";
    } else if (reason === 'autobackup' || reason === 'drive') {
      if (titleEl) titleEl.textContent = "Copias de seguridad avanzadas y en la Nube";
      if (descEl) descEl.textContent = "El historial de 7 días de respaldos automáticos y la sincronización en Google Drive son funciones reservadas para usuarios de GestiFactu PRO.";
    } else {
      if (titleEl) titleEl.textContent = "Desbloquea todo el potencial para tu negocio";
      if (descEl) descEl.textContent = "Olvídate de límites y suscripciones abusivas. Factura como un profesional con un pago único de 19,99 € o suscripción flexible.";
    }

    modal.classList.remove('hidden');
  }

  function closePaywall() {
    const modal = document.getElementById('modal-pro-paywall');
    if (modal) {
      modal.classList.add('hidden');
    }
  }
  window.closePaywall = closePaywall;

  function buyPlan(planType) {
    const skuMap = {
      lifetime: 'gestifactu_pro_lifetime',
      yearly: 'gestifactu_pro_yearly',
      monthly: 'gestifactu_pro_monthly'
    };

    const sku = skuMap[planType] || skuMap.lifetime;

    if (isAndroid && typeof window.AndroidBridge.launchBilling === 'function') {
      window.AndroidBridge.launchBilling(sku);
    } else {
      // Browser demo checkout
      const confirmDemo = confirm(
        `[Modo Web / Pruebas]\n¿Deseas activar la licencia PRO "${planType}" de prueba ahora mismo?`
      );
      if (confirmDemo) {
        setProWeb(true, planType);
      }
    }
  }

  function restorePurchases() {
    if (isAndroid && typeof window.AndroidBridge.restorePurchases === 'function') {
      window.AndroidBridge.restorePurchases();
      if (typeof window.showToast === 'function') {
        window.showToast("Buscando compras previas en tu cuenta de Google Play...", "info");
      }
    } else {
      if (typeof window.showToast === 'function') {
        window.showToast("No se encontraron compras en el entorno de pruebas.", "warning");
      }
    }
  }

  function redeemPromoCode(code) {
    if (!code) return;
    const clean = code.trim().toUpperCase();

    if (isAndroid && typeof window.AndroidBridge.activatePromo === 'function') {
      const ok = window.AndroidBridge.activatePromo(clean);
      if (ok) {
        closePaywall();
        updateUi,
    recordOcrScan();
        if (typeof window.showToast === 'function') {
          window.showToast("¡Código de activación verificado! GestiFactu PRO desbloqueado de por vida.", "success");
        }
      } else {
        if (typeof window.showToast === 'function') {
          window.showToast("Código promocional no válido o expirado.", "error");
        }
      }
      return;
    }

    // Web fallback validation
    if (PROMO_CODES.includes(clean)) {
      setProWeb(true, 'lifetime_promo');
      closePaywall();
      if (typeof window.showToast === 'function') {
        window.showToast("¡Código de activación verificado! GestiFactu PRO desbloqueado.", "success");
      }
    } else {
      if (typeof window.showToast === 'function') {
        window.showToast("Código no válido. Prueba con: PRO2026", "error");
      }
    }
  }

  function setProWeb(active, plan = 'lifetime') {
    localStorage.setItem('gestifactu_pro_active', active ? 'true' : 'false');
    localStorage.setItem('gestifactu_pro_plan', plan);
    localStorage.setItem('gestifactu_pro_date', new Date().toISOString());
    updateUi();
  }

  function toggleDevPro() {
    const next = !isPro();
    if (isAndroid && typeof window.AndroidBridge.setDevPro === 'function') {
      window.AndroidBridge.setDevPro(next);
    } else {
      setProWeb(next, next ? 'dev_license' : 'free');
    }
    updateUi();
    if (typeof window.showToast === 'function') {
      window.showToast(next ? "Modo GestiFactu PRO activado" : "Modo Gratuito activado", "info");
    }
  }

  function updateUi() {
    const pro = isPro();
    const usage = getMonthlyUsage();

    // 1. Topbar Badge
    const badgeContainer = document.getElementById('pro-topbar-badge-container');
    if (badgeContainer) {
      if (pro) {
        badgeContainer.innerHTML = `
          <button type="button" onclick="GestiPro.openPaywall('pro_status')" class="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 h-8 sm:h-9 rounded-full text-xs font-bold bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-sm hover:brightness-105 active:scale-95 transition cursor-pointer" style="touch-action: manipulation;">
            <i class="fa-solid fa-crown text-yellow-200 pointer-events-none"></i>
            <span class="hidden xs:inline pointer-events-none">GestiFactu </span><span class="pointer-events-none">PRO</span>
            <i class="fa-solid fa-circle-check text-yellow-300 text-[10px] ml-0.5 pointer-events-none"></i>
          </button>
        `;
      } else {
        badgeContainer.innerHTML = `
          <button type="button" onclick="GestiPro.openPaywall('badge')" class="flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 h-8 sm:h-9 rounded-full text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100 active:scale-95 transition shadow-sm cursor-pointer" style="touch-action: manipulation;">
            <i class="fa-solid fa-bolt text-amber-500 pointer-events-none"></i>
            <span class="pointer-events-none font-bold">(${usage.invoicesThisMonth}/${LIMITS.MAX_INVOICES_PER_MONTH})</span>
            <span class="bg-amber-500 text-white font-bold text-[10px] px-1.5 py-0.5 rounded-full shadow-xs pointer-events-none">PRO</span>
          </button>
        `;
      }
    }

    // 2. Sidebar PRO Card / Banner
    const sidebarProCard = document.getElementById('sidebar-pro-card');
    if (sidebarProCard) {
      if (pro) {
        sidebarProCard.classList.add('hidden');
      } else {
        sidebarProCard.classList.remove('hidden');
        const countSpan = document.getElementById('sidebar-free-invoice-count');
        if (countSpan) countSpan.textContent = `${usage.invoicesThisMonth}/${LIMITS.MAX_INVOICES_PER_MONTH}`;
      }
    }

    // 3. Reports Lock Overlay
    const reportsOverlay = document.getElementById('reports-pro-lock-overlay');
    if (reportsOverlay) {
      if (pro) {
        reportsOverlay.classList.add('hidden');
      } else {
        reportsOverlay.classList.remove('hidden');
      }
    }
  }

  // Hook for native callback
  window.onBillingStatus = function(isProActive, planType, message) {
    updateUi();
    if (typeof window.showToast === 'function' && message) {
      window.showToast(message, isProActive ? "success" : "info");
    }
  };

  return {
    LIMITS,
    isPro,
    getProDetails,
    getMonthlyUsage,
    openPaywall,
    closePaywall,
    buyPlan,
    restorePurchases,
    redeemPromoCode,
    toggleDevPro,
    updateUi
  };
})();
