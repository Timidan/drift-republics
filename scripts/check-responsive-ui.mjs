// In the connected in-app browser: await checkResponsiveUI(tab), at a phone viewport.
import assert from 'node:assert/strict';

export async function checkResponsiveUI(tab) {
  await tab.playwright.getByRole('button', { name: 'Workshop', exact: true }).press('Enter');
  const layout = await tab.playwright.evaluate(() => {
    const box = id => document.getElementById(id).getBoundingClientRect();
    const nav = document.getElementById('game-tabs');
    return {
      viewport: [innerWidth, innerHeight], textSize: document.getElementById('text-scale').value,
      headerGap: box('game-context').top - box('hud-top').bottom,
      navGap: box('game-tabs').top - box('game-context').bottom,
      contentHeight: box('context-content').height, navOverflow: nav.scrollWidth - nav.clientWidth,
      inputSize: getComputedStyle(document.querySelector('#context-content input')).fontSize,
      focus: document.activeElement.id,
      targets: Array.from(nav.querySelectorAll(':scope > button')).filter(b => b.getClientRects().length)
        .map(b => [b.textContent.trim(), b.getBoundingClientRect().width, b.getBoundingClientRect().height]),
    };
  });
  assert(layout.headerGap >= 7 && layout.navGap >= 7, 'workspace overlaps navigation or header');
  assert(layout.contentHeight >= 160 && layout.navOverflow <= 1, 'content or navigation is clipped');
  assert(parseFloat(layout.inputSize) >= 16 && layout.focus === 'context-title', 'input text or opening focus regressed');
  assert(layout.targets.length <= 5 && layout.targets.every(([, w, h]) => w >= 43.9 && h >= 43.9), 'phone targets are crowded');
  const more = tab.playwright.getByRole('button', { name: 'More game views', exact: true });
  await more.press('Enter');
  await more.press('Escape');
  assert(await tab.playwright.evaluate(() => !document.getElementById('more-views').matches(':popover-open') && !document.getElementById('game-context').hidden), 'Escape should dismiss only More');
  await more.press('Enter');
  await tab.playwright.getByRole('button', { name: 'Republic', exact: true }).press('Enter');
  assert(await tab.playwright.evaluate(() => document.getElementById('context-title').textContent === 'The republic' && document.activeElement.id === 'context-title' && !document.getElementById('more-views').matches(':popover-open')), 'secondary navigation failed');
  return layout;
}
