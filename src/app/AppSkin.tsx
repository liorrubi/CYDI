/*
 * © 2026 Lior Rubinovich. All rights reserved.
 * Unauthorized copying, modification, distribution, or commercial use is prohibited.
 */
/**
 * The Android visual refresh, in one wrapper.
 *
 * WHAT IT IS. A single <div class="app-shell"> around the whole rendered app,
 * plus the stylesheet that hangs off that class. It renders NOTHING of its own
 * - no chrome, no header, no strip - so it cannot change a layout, a flow or a
 * tap target. It exists purely so appShell.css has something to attach to.
 *
 * WHY IT EXISTS. src/styles/global.css is shared byte-for-byte between the
 * Android WebView and the web game screens, so restyling Android by editing it
 * would restyle the website at the same time. This is the mirror image of
 * src/site/SiteGameSkin.tsx, which does the same job for the web: one class,
 * one scoped stylesheet, no overlap.
 *
 * WHERE IT RENDERS. App.tsx mounts it only when Capacitor.isNativePlatform()
 * is true, so the class never appears in a browser and every rule in
 * appShell.css is inert on the web even if the file is bundled there.
 *
 * DELIBERATELY NOT A THEME SWITCH. The player's light/dark choice still comes
 * from data-theme on the document root; appShell.css consumes the same tokens
 * and works under both. This adds identity and hierarchy, not a third theme.
 */
import type { ReactNode } from "react";
import { useCrawlableBlockTakeover } from "../site/crawlableBlock";
import "../styles/appShell.css";

type AppSkinProps = { children: ReactNode };

export default function AppSkin({ children }: AppSkinProps) {
  // The bundled index.html is the prerendered public page, so it carries the Worker's
  // crawlable block (section.cydi-seo) after #root. The web's site and game shells remove it
  // once the UI is on screen; Android mounts neither, so without this the whole SEO page sat
  // under every Android screen (~1,280 px): every screen became scrollable, rounds inherited
  // scroll offsets, and its site links could navigate the WebView away from the game.
  useCrawlableBlockTakeover();
  return <div className="app-shell">{children}</div>;
}
