# 0004: Primary action comes before Cancel
- Date: 2026-11-13
- Status: accepted

In every form and dialog the primary action (Save, Create, Apply, Import, …)
comes first in the DOM, then any secondary submit (e.g. "Create & Add Another"),
then Cancel, and finally Delete when it exists. Tab from the last input then
lands on the primary action, not on Cancel.

The visual order follows the DOM order; do not reorder with CSS
(`order`, `row-reverse`), since that would split the tab order from what the
user sees.
