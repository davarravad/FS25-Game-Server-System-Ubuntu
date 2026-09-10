<?php
declare(strict_types=1);

// Run with output buffering disabled, as in the stock PHP-FPM image.
// Any output while loading a view helper can corrupt every JSON endpoint.
foreach (['telemetry-view.php', 'sidebar.php'] as $helper) {
    ob_start();
    require __DIR__ . '/../app/web/src/' . $helper;
    $output = ob_get_clean();
    if ($output !== '') {
        fwrite(STDERR, $helper . ' emitted ' . strlen($output) . " bytes while loading\n");
        exit(1);
    }
}

if (headers_sent($file, $line)) {
    fwrite(STDERR, "Headers were already sent by $file:$line\n");
    exit(1);
}
header('Content-Type: application/json');
echo json_encode(['ok' => true, 'message' => 'View helpers load without emitting output']);
