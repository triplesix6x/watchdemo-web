// Keep a diagnostic document reloadable without changing the application router.
export function localDiagnosticBootstrap(variant) {
  const label = JSON.stringify(variant)
  return `(() => {
    const variant = ${label};
    const documentUrl = location.pathname + location.search;
    window.__localDiagnostic = variant;
    if (variant === 'dom-commit') document.documentElement.dataset.localDomCommits = new URLSearchParams(location.search).get('domCommits') === 'off' ? 'off' : 'on';
    if (variant === 'surface') document.documentElement.dataset.localSurface = new URLSearchParams(location.search).get('surface') === 'flat' ? 'flat' : 'original';
    if (variant === 'radar-webgl') {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(...args) {
        const result = getContext.apply(this, args);
        if (args[0] === 'webgl2' && result && this.classList.contains('radar-canvas')) this.dataset.localRadarBackend = 'webgl2';
        return result;
      };
    }
    history.replaceState(history.state, '', '/?localDiagnostic=' + encodeURIComponent(variant));
    const ready = () => {
      if (!document.querySelector('.story')) return false;
      if (variant === 'radar-layers' && document.querySelectorAll('.story-stage canvas.radar-layer').length !== 37) return false;
      if (variant === 'radar-webgl') {
        if (!document.querySelector('.story-stage canvas.radar-canvas[data-local-radar-backend="webgl2"]')) return false;
      }
      history.replaceState(history.state, '', documentUrl);
      document.documentElement.dataset.localDiagnostic = variant;
      const badge = document.createElement('div');
      badge.dataset.diagnosticBadge = variant;
      badge.textContent = 'LOCAL: ' + variant + ' ACTIVE' + (variant === 'dom-commit' ? ' commits=' + document.documentElement.dataset.localDomCommits : '') + (variant === 'surface' ? ' skin=' + document.documentElement.dataset.localSurface : '');
      badge.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99999;padding:6px 10px;background:#16241b;color:#b7f7c8;border:1px solid #71957b;font:12px/1.4 monospace;pointer-events:none';
      document.body.append(badge);
      return true;
    };
    const observer = new MutationObserver(() => { if (ready()) observer.disconnect(); });
    observer.observe(document.documentElement, {childList:true,subtree:true,attributes:true,attributeFilter:['data-local-radar-backend']});
  })();`
}
