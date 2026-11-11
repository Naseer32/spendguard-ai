/** Standard page wrapper: consistent width, padding, title row. */
export default function PageContainer({ title, description, actions, children }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-ink-muted sm:text-base">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="space-y-5 sm:space-y-6">{children}</div>
    </div>
  );
}
