<?php
function render_telemetry(array $targets, string $title): void {
?>
<section class="telemetry" aria-label="<?= h($title) ?>">
    <div class="telemetry-heading"><div><span class="telemetry-eyebrow">RESOURCE OBSERVATORY</span><h2><?= h($title) ?></h2></div><a href="/?route=game_servers">Game servers &rarr;</a></div>
    <div class="telemetry-toolbar">
        <label>Monitor <select data-metric-target><?php foreach ($targets as $target): ?><option value="<?= h($target['query']) ?>"><?= h($target['name']) ?></option><?php endforeach; ?></select></label>
        <div class="telemetry-ranges" role="group" aria-label="History range"><?php foreach ([1=>'1H',6=>'6H',24=>'24H',168=>'7D',720=>'30D'] as $hours=>$label): ?><button type="button" data-hours="<?= $hours ?>" aria-pressed="<?= $hours === 1 ? 'true' : 'false' ?>"><?= $label ?></button><?php endforeach; ?></div>
        <button type="button" data-metric-pause>Pause live</button>
    </div>
    <p class="telemetry-status" role="status">Waiting for the first sample…</p>
    <div class="telemetry-grid"></div>
    <p class="telemetry-note">Samples collected in the background every ~30 seconds. Disk scans every 5 minutes. History retained for 30 days; longer views show bucket averages. Host disk measures the instances filesystem; server disk measures its instance folder. Server CPU: 100% = one logical core. Network rates exclude host loopback and Docker bridge interfaces; server rates measure the game container.</p>
</section>
<?php } ?>

