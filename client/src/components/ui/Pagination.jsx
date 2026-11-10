export default function Pagination({ pagination, loading, onPage }) {
  const { page, limit, total } = pagination
  const more = BigInt(page) * BigInt(limit) < BigInt(total) && page < 1000000
  return <div className="catalog-footer"><span role="status">Page {page} · {total} records</span><div className="flex items-center gap-2"><button type="button" className="secondary-button" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>Previous</button><button type="button" className="secondary-button" disabled={loading || !more} onClick={() => onPage(page + 1)}>Next</button></div></div>
}
