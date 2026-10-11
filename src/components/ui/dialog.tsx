"use client";

import { Dialog as Primitive } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;

/** Centered modal with focus trap, Escape to close and a labelled title (Radix). */
export function DialogContent({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <Primitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-panel border border-line bg-surface p-5 shadow-lg",
          className,
        )}
      >
        <Primitive.Title className="text-base font-semibold text-ink">{title}</Primitive.Title>
        {description ? (
          <Primitive.Description className="mt-1 text-sm text-muted">{description}</Primitive.Description>
        ) : (
          <Primitive.Description className="sr-only">{title}</Primitive.Description>
        )}
        <div className="mt-4">{children}</div>
      </Primitive.Content>
    </Primitive.Portal>
  );
}

/** Slide-in panel from the left (mobile navigation). */
export function SheetContent({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <Primitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface">
        <Primitive.Title className="sr-only">{title}</Primitive.Title>
        <Primitive.Description className="sr-only">{title}</Primitive.Description>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}
