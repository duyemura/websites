import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

export const Dialog = ({ open, onOpenChange, children, className }: DialogProps) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        className={cn(
          "relative z-50 w-full max-w-5xl rounded-lg border bg-card p-0 shadow-lg",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
};

export const DialogContent = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={cn("flex h-[80vh] overflow-hidden rounded-lg", className)}>{children}</div>
);

export const DialogClose = ({ onClick }: { onClick?: () => void }) => (
  <button
    onClick={onClick}
    className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
  >
    <X className="h-5 w-5" />
    <span className="sr-only">Close</span>
  </button>
);
