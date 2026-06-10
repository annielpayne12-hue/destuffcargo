import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationNext, PaginationPrevious, PaginationEllipsis,
} from '@/components/ui/pagination';

interface TablePaginationProps {
  currentPage: number;       // 1-based
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems?: number;
  pageSize?: number;
  className?: string;
}

/** Generates page numbers with ellipsis for large ranges */
function pageWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | '…')[] = [];
  if (current <= 4) {
    pages.push(1, 2, 3, 4, 5, '…', total);
  } else if (current >= total - 3) {
    pages.push(1, '…', total - 4, total - 3, total - 2, total - 1, total);
  } else {
    pages.push(1, '…', current - 1, current, current + 1, '…', total);
  }
  return pages;
}

export function TablePagination({
  currentPage, totalPages, onPageChange, totalItems, pageSize, className,
}: TablePaginationProps) {
  if (totalPages <= 1) return null;

  const start = pageSize ? (currentPage - 1) * pageSize + 1 : undefined;
  const end   = pageSize && totalItems ? Math.min(currentPage * pageSize, totalItems) : undefined;

  return (
    <div className={`flex flex-col md:flex-row md:items-center md:justify-between gap-2 pt-3 ${className ?? ''}`}>
      {totalItems !== undefined && pageSize !== undefined && (
        <p className="text-xs text-muted-foreground shrink-0">
          Showing {start}–{end} of {totalItems}
        </p>
      )}
      <Pagination className="md:justify-end">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={(e) => { e.preventDefault(); if (currentPage > 1) onPageChange(currentPage - 1); }}
              className={currentPage === 1 ? 'pointer-events-none opacity-40' : ''}
            />
          </PaginationItem>
          {pageWindow(currentPage, totalPages).map((p, i) =>
            p === '…' ? (
              <PaginationItem key={`ellipsis-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  href="#"
                  isActive={p === currentPage}
                  onClick={(e) => { e.preventDefault(); onPageChange(p as number); }}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            )
          )}
          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={(e) => { e.preventDefault(); if (currentPage < totalPages) onPageChange(currentPage + 1); }}
              className={currentPage === totalPages ? 'pointer-events-none opacity-40' : ''}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
