<script>
  import { exists, BaseDirectory } from '@tauri-apps/api/fs'
  const checkDefaultEDJournalLocation = async () => {
    return await exists('Saved Games\\Frontier Developments\\Elite Dangerous', { dir: BaseDirectory.Home })
  }

</script>
<h1>Welcome to Loopy Science</h1>
{#await checkDefaultEDJournalLocation()}
    <!-- promise is pending -->
    <p>Checking for default Elite Dangerous Jorunal location.</p>
{:then defaultEDJournalLocationExists}
    <!-- promise was fulfilled -->
    {#if defaultEDJournalLocationExists}
        <p>Journal Files Detected!</p>
        {:else }
        <p>Journal Files NOT Detected!</p>
    {/if}
{:catch error}
    <!-- promise was rejected -->
    <p>Something went wrong: {error}</p>
{/await}