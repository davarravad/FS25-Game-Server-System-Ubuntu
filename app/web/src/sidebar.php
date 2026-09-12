<?php

function render_sidebar(string $activeRoute, string $username): void
{
    if (in_array($activeRoute, ['server', 'logs', 'console', 'web_admin'], true)) {
        $activeRoute = 'game_servers';
    }
    $groups = [
        'Workspace' => [
            ['dashboard', 'Overview', 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z'],
            ['game_servers', 'Game Servers', 'M5 6h14l3 12h-5l-3-3h-4l-3 3H2z M6 9v5 M3.5 11.5h5 M16 10h.01 M19 13h.01'],
            ['create_server', 'Create Server', 'M12 5v14 M5 12h14'],
        ],
        'Management' => [
            ['managed_hosts', 'Managed Hosts', 'M3 3h18v7H3z M3 14h18v7H3z M7 6.5h.01 M7 17.5h.01 M11 6.5h6 M11 17.5h6'],
            ['file_management', 'File Management', 'M3 5h6l2 3h10v12H3z'],
            ['docs', 'Docs', 'M4 3h12l4 4v14H4z M15 3v5h5 M8 12h8 M8 16h6'],
        ],
    ];
    ?>
    <a class="panel-skip" href="#panel-content">Skip to content</a>
    <details class="panel-navigation" open>
        <summary class="panel-menu"><span class="panel-monogram" aria-hidden="true">F</span><span>FSG FS25 Node</span><span class="panel-menu-label">Menu</span></summary>
        <aside class="panel-sidebar" aria-label="Panel navigation">
            <a class="panel-brand" href="/?route=dashboard"><span class="panel-monogram" aria-hidden="true">F</span><span><strong>FSG FS25</strong><small>SERVER CONTROL</small></span></a>
            <nav aria-label="Main navigation">
                <?php foreach ($groups as $label => $links): ?>
                    <div class="panel-nav-group"><p><?= h($label) ?></p>
                        <?php foreach ($links as [$route, $title, $icon]): ?>
                            <a class="panel-nav-link" href="/?route=<?= h($route) ?>" <?= $activeRoute === $route ? 'aria-current="page"' : '' ?>><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="<?= h($icon) ?>"/></svg><span><?= h($title) ?></span></a>
                        <?php endforeach; ?>
                    </div>
                <?php endforeach; ?>
            </nav>
            <div class="panel-account"><span class="panel-avatar" aria-hidden="true"><?= h(strtoupper(substr($username, 0, 1))) ?></span><div><strong><?= h($username) ?></strong><span>Signed in</span></div><a href="/?route=logout" aria-label="Sign out" title="Sign out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M9 4H4v16h5 M9 12h12 M16 7l5 5-5 5"/></svg></a></div>
        </aside>
    </details>
    <?php
}
