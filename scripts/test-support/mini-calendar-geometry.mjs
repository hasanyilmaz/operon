import assert from 'node:assert/strict';

/** Regression coverage for centered dates, equal week columns, and accessible tooltip-free week buttons. */
export async function assertMiniCalendarGeometry(page, continuous = false) {
 const geometry = await page.evaluate(continuous => {
  const root = document.getElementById('panel');
  const days = [...root.querySelectorAll('[data-date-key]')];
  const week = root.querySelector('[data-week-date]');
  const rect = el => el.getBoundingClientRect();
  const textRect = button => {
   const label = button.querySelector('.operon-mini-day-number, .operon-mini-month-label');
   if (label) return rect(label);
   const range = document.createRange(); range.selectNode(button.firstChild); return range.getBoundingClientRect();
  };
  const centers = days.map(button => {
   const cell = rect(button), text = textRect(button);
   return { date: button.dataset.dateKey, x: text.left + text.width / 2 - cell.left - cell.width / 2,
    y: text.top + text.height / 2 - cell.top - cell.height / 2 };
  });
  const dayStyle = getComputedStyle(days[0]), weekStyle = getComputedStyle(week);
  return { centers, dayWidth: rect(days[0]).width, weekWidth: rect(week).width,
   dayHeight: rect(days[0]).height, weekHeight: rect(week).height,
   dayRadius: dayStyle.borderRadius, weekRadius: weekStyle.borderRadius,
   dayBorder: dayStyle.borderWidth, weekBorder: weekStyle.borderWidth,
   dayFont: dayStyle.fontSize, weekFont: weekStyle.fontSize, weekDecoration: weekStyle.textDecorationLine,
   headerWidths: [...root.querySelector('.operon-calendar-sidebar-month-weekdays').children].map(el=>rect(el).width),
   tooltipBound: Boolean(week._operonHoverCleanup),
   weekName: document.getElementById(week.getAttribute('aria-labelledby'))?.textContent,
   monthOnly: !continuous || days.every(button => button.dataset.dateKey.endsWith('-01')
    ? Boolean(button.querySelector('.operon-mini-month-label')) && !button.querySelector('.operon-mini-day-number')
    : Boolean(button.querySelector('.operon-mini-day-number')) && !button.querySelector('.operon-mini-month-label')) };
 }, continuous);
 assert.ok(geometry.centers.every(p=>Math.abs(p.x)<=1 && Math.abs(p.y)<=1), JSON.stringify(geometry.centers));
 assert.ok(Math.abs(geometry.dayWidth-geometry.weekWidth)<1, JSON.stringify(geometry));
 assert.equal(geometry.weekDecoration, 'underline');
 assert.equal(geometry.dayHeight,geometry.weekHeight); assert.equal(geometry.dayRadius,geometry.weekRadius);
 assert.equal(geometry.dayBorder,geometry.weekBorder); assert.equal(geometry.dayFont,geometry.weekFont);
 assert.ok(geometry.headerWidths.every(width=>Math.abs(width-geometry.dayWidth)<1));
 assert.equal(geometry.tooltipBound,false); assert.ok(geometry.weekName?.includes('2027') || geometry.weekName?.includes('2026'));
 assert.equal(geometry.monthOnly,true);
 const week = continuous
  ? page.locator('.operon-mini-calendar-week').filter({has:page.locator('.is-anchor[data-date-key]')}).locator('[data-week-date]')
  : page.locator('[data-week-date]').first();
 await week.hover(); await page.waitForTimeout(80);
 assert.equal(await page.locator('.operon-hover-tooltip').count(),0);
 await page.locator('#outside').hover();
}
