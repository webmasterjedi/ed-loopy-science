<script>
  export let data

  function processEntries (entries) {
    for (const entry of entries) {
      console.log(`Entry: ${entry.path}`)
      if (entry.children) {
        processEntries(entry.children)
      }
    }
  }

  if (data.journal.entries) {
    processEntries(data.journal.entries)
  }
</script>
{#if data.journal.entries}
    <h3>Detected Journal Files</h3>
    <ul>
    {#each data.journal.entries as entry}
        <li>{entry.name}</li>
    {/each}
    </ul>

{:else}
    <p>Loading...</p>
{/if}