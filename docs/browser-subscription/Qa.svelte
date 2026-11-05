<script>
  import NotesTab from "@desktop/lib/components/NotesTab.svelte";
  import ImportModal from "@desktop/lib/components/ImportModal.svelte";
  import { api } from "@desktop/lib/api";
  import { authStore } from "@desktop/lib/auth.svelte";
  import { importState } from "@desktop/lib/import.svelte";
  import { setLocale } from "@desktop/lib/i18n/index.svelte";
  import "@desktop/app.css";

  let visible = $state(true);
  let persisted = "Saved QA note";
  let failRead = false;
  const writes = [];
  const account = "00000000-0000-4000-8000-000000000001";
  setLocale("en");
  // Test transport only: actual production store, editor, components and dialogs.
  api.entityNote = async () => {
    if (failRead) throw new Error("QA simulated read failure");
    return { text: persisted };
  };
  api.setEntityNote = async (_kind, _id, text) => { writes.push(text); persisted = text; };
  authStore.state = { status: "online", user: { id: account, username: "qa-user" } };
  authStore.local = { account_id: account, activation_epoch: 1, tier: "plus", online: true };
  authStore.ready = true;
  const demo = { id: "00000000-0000-4000-8000-000000000002", display_name: "QA demo — named deletion" };
  window.qa = {
    hide: () => { visible = false; },
    show: () => { visible = true; },
    refresh: () => { authStore.local = { ...authStore.local }; },
    fail: (value) => { failRead = value; },
    reactivate: () => { authStore.local = { ...authStore.local, activation_epoch: authStore.local.activation_epoch + 1 }; },
    free: () => { authStore.local = { ...authStore.local, tier: "basic" }; },
    writes: () => [...writes],
    openImport: () => {
      importState.plan = { plan_id: "qa-plan", selection_required: true, candidates: [
        { id: "a", display_name: "QA demo A", file_size: 1048576, map_name: "de_qa" },
        { id: "b", display_name: "QA demo B", file_size: 1048576, map_name: "de_qa" },
      ], duplicates: 0, failed: [], access: { features: [{ id: "demo_import", allowed: true, remaining: 1, resets_at: "2026-12-01T00:00:00Z" }] } };
      importState.selected = [];
      importState.phase = "selecting";
    },
  };
</script>
<svelte:head><title>Isolated subscription QA</title></svelte:head>
<main class="h-screen bg-ink-950 text-ink-50">
  {#if visible}<NotesTab {demo} />{/if}
  <ImportModal />
</main>
