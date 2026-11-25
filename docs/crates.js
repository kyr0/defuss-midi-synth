// Each grid has a defuss-dataview record per sleeve. The virtual list materializes only visible rows.
export function mountCrate({ id, search, count, albums, sleeve, upload }) {
  let grid = document.getElementById(id);
  const parent = grid.parentElement, template = grid.cloneNode(false);
  template.removeAttribute('data-init');
  const input = document.getElementById(search), output = document.getElementById(count);
  const api = globalThis.df$.shadcn.virtualList;
  const records = albums.map(album => ({
    id: album.id, album, terms: [album.title, album.year, album.platform, album.source, ...album.composers,
      ...album.editions.flatMap(e => e.tracks.map(t => [t.title, t.artist, t.year].filter(Boolean).join(' ')))].join(' ').toLowerCase(),
  }));
  if (upload) records.unshift({ id: 'your-midi', terms: 'your midi' });
  let columns;
  function query() {
    const filters = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean).map(value => ({ field: 'terms', op: 'contains', value }));
    api.query(grid, { filters, index: 0 });
    const total = api.rows(grid).filter(row => row.album).length;
    output.textContent = `${total} ${upload ? total === 1 ? 'album' : 'albums' : total === 1 ? 'artist' : 'artists'}`;
  }
  function layout() {
    const next = Math.max(2, Math.min(upload ? 3 : 5, Math.floor(parent.clientWidth / 172)));
    if (next === columns) return;
    if (columns) { const fresh = template.cloneNode(false); grid.replaceWith(fresh); grid = fresh; }
    columns = next;
    grid.dataset.columns = String(columns);
    grid.setAttribute('aria-colcount', String(columns));
    grid.style.setProperty('--virtual-list-columns', columns);
    api.setSource(grid, records, { render: (cell, { album }) => cell.replaceChildren(album ? sleeve(album) : upload) });
    // A newly attached grid mounts in the component's MutationObserver.
    if (grid.store) query(); else queueMicrotask(query);
  }
  layout(); new ResizeObserver(layout).observe(parent);
  input.addEventListener('input', query);
  if (upload) document.querySelector('a[href="#your-midi"]').addEventListener('click', () => {
    input.value = ''; query();
    upload.scrollIntoView({ block: 'center' });
  });
}
