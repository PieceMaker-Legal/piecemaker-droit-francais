import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

export function Section({ title, count, action, children, initiallyOpen = true }: { title: string; count: number; action?: ReactNode; children: ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <section className="py-1">
    <div className="flex items-center">
      <button type="button" aria-expanded={open} className="flex flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <span className="text-[15px] text-foreground">{title}</span><span className="text-sm text-muted-foreground">{count}</span>
      </button>
      {action}
    </div>
    {open && <div className="pb-2 pl-8">{children}</div>}
  </section>;
}
