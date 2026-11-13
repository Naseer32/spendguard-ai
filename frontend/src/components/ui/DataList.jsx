/**
 * Responsive list: a table from `md` up, a stack of cards below it (no
 * horizontal scrolling on phones).
 *
 * columns:  [{ key, header, align?: 'right', className?, render(row) }]
 * renderCard(row) returns the phone layout for one row.
 * onOpen(row), when given, makes rows keyboard- and touch-activatable.
 */
export default function DataList({ rows, getKey, columns, renderCard, onOpen, caption }) {
  return (
    <>
      <table className="hidden w-full text-left text-sm md:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
            {columns.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                className={`py-3 font-semibold ${i === 0 ? 'pl-5 pr-3' : i === columns.length - 1 ? 'pl-3 pr-5' : 'px-3'} ${c.align === 'right' ? 'text-right' : ''}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr
              key={getKey(row)}
              onClick={onOpen ? () => onOpen(row) : undefined}
              className={onOpen ? 'cursor-pointer hover:bg-accent-50/40' : undefined}
            >
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={`py-3.5 align-middle ${i === 0 ? 'pl-5 pr-3' : i === columns.length - 1 ? 'pl-3 pr-5' : 'px-3'} ${c.align === 'right' ? 'text-right' : ''} ${c.className ?? ''}`}
                >
                  {i === 0 && onOpen ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(row);
                      }}
                      className="text-left"
                    >
                      {c.render(row)}
                    </button>
                  ) : (
                    c.render(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-line md:hidden">
        {rows.map((row) => (
          <li key={getKey(row)}>
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(row)}
                className="block w-full px-4 py-3.5 text-left active:bg-accent-50/60"
              >
                {renderCard(row)}
              </button>
            ) : (
              <div className="px-4 py-3.5">{renderCard(row)}</div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
