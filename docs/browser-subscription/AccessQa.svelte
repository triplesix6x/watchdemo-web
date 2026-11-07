<script>
  import LoginApp from '@desktop/LoginApp.svelte';
  import AccountModal from '@desktop/lib/components/AccountModal.svelte';
  import { api } from '@desktop/lib/api';
  import { authStore, attachAuthListeners, detachAuthListeners, refreshAccess } from '@desktop/lib/auth.svelte';
  import { parseAccessSnapshot } from '@desktop/lib/subscription';
  import { setLocale } from '@desktop/lib/i18n/index.svelte';
  import { emitQa, nativeCalls } from './native-access-qa.js';
  import '@desktop/app.css';

  let mode = $state('account');
  let visible = $state(false);
  const account = '00000000-0000-4000-8000-000000000011';
  let currentTier = 'basic';
  let epoch = 1;
  const calls = { access: 0, local: 0, state: 0 };
  setLocale('en');
  const local = () => ({ account_id: account, activation_epoch: epoch, tier: currentTier, online: true });
  const authStateView = () => ({ status: 'online', user: { id: account, email: 'qa@example.invalid', username: 'qa-user',
    role: 'user', is_verified: true, subscription: { tier: currentTier, effective_tier: currentTier,
      started_at: '2026-01-01T00:00:00Z', expires_at: null, is_expired: false } } });
  function snapshot() {
    const rank = ['basic', 'plus', 'pro'].indexOf(currentTier);
    return parseAccessSnapshot({ protocol_version: 1, server_time: '2026-11-06T00:00:00Z', tier: currentTier,
      paid_cycle_anchor: rank ? '2026-01-01T00:00:00Z' : null, subscription_expires_at: null,
      group_generation: 0, lease: null,
      features: ['demo_import', 'custom_sets', 'demo_groups', 'replay2d', 'advanced_stats', 'content_search', 'voice', 'notes', 'playbooks'].map(id => {
        const min = id === 'playbooks' ? 2 : ['voice', 'notes'].includes(id) ? 1 : 0;
        const allowed = rank >= min;
        const monthly = id === 'demo_import' ? [5, 15, null][rank] : id === 'custom_sets' ? [1, 2, null][rank] : null;
        const limit = id === 'demo_groups' ? [2, 5, null][rank] : null;
        return { id, allowed, min_tier: ['basic', 'plus', 'pro'][min], monthly_limit: monthly, limit,
          limit_period: monthly === null ? null : rank ? 'activation_month' : 'calendar_month', scope: 'account',
          used: 0, reserved: 0, remaining: allowed ? monthly ?? limit : 0,
          resets_at: ['demo_import', 'custom_sets'].includes(id) ? '2026-12-01T00:00:00Z' : null };
      }) });
  }
  api.authState = async () => { calls.state++; return authStateView(); };
  api.authLocalAccess = async () => { calls.local++; return local(); };
  api.authAccess = async () => { calls.access++; return snapshot(); };
  api.authLogin = async () => {};
  api.openExternal = async () => {};
  window.qaAccess = {
    start: async (tier) => {
      visible = false; detachAuthListeners(); currentTier = tier; epoch++;
      Object.keys(calls).forEach(key => calls[key] = 0);
      await attachAuthListeners(); visible = true; mode = 'account';
    },
    counts: () => ({ ...calls }), nativeCalls,
    burst: async () => { await Promise.all(Array.from({ length: 8 }, () => emitQa('auth://state', authStateView()))); },
    localBurst: async () => { await Promise.all(Array.from({ length: 8 }, () => emitQa('access://changed', local()))); },
    refresh: () => Promise.all(Array.from({ length: 8 }, () => refreshAccess())),
    snapshot: () => authStore.access,
    login: () => { visible = false; mode = 'login'; },
    locale: (locale) => setLocale(locale),
  };
</script>
<svelte:head><title>Isolated desktop access and login QA</title></svelte:head>
{#if mode === 'login'}<LoginApp />{:else}<main class="h-screen bg-ink-950 text-ink-50">{#if visible}<AccountModal onClose={() => visible = false} />{/if}</main>{/if}
