# 0002: List pages page on the server
- Date: 2026-11-01
- Status: accepted

Every list page shows one server page at a time, through the `pagination` prop of
the solid-components table and `usePagedList` (`client/src/lib/paged_list.ts`).

- **Pager:** below the table, with the range, previous/next and a rows-per-page
  select. It replaces the "Showing X-Y of Z" line.
- **Page size:** 25, 50, 100 or 200, default 50. One preference for all lists,
  kept in `localStorage`. 200 is the server's limit.
- **Page state:** not in the URL, because a pane remounts when its path changes.
  Each tab history entry remembers its page, so going back lands where the user
  left. Search, filters and sort are not remembered, so the page only comes back
  for the same query.
- **Changing the query:** a new search, filter or sort goes to page 1. A page past
  the end (rows deleted) moves to the last page.
- **Loading:** the previous rows stay until the next page arrives; the loading line
  only shows without rows, so the pager does not jump.

Rows must not depend on other rows of the list, as those may sit on another page:
values derived from a row's relatives (tree depth, parent name) come from the
server. Sort orders end in a unique column to keep pages stable.

Pickers and lookups (`createRows`) are not paged; they load the first 200 rows.
