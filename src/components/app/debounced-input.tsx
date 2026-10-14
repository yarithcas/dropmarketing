"use client";

import { useEffect, useState, type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";

export function DebouncedInput({ value, onCommit, delay = 300, ...props }: { value: string; onCommit: (v: string) => void; delay?: number } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    const id = setTimeout(() => v !== value && onCommit(v), delay);
    return () => clearTimeout(id);
  }, [v, value, onCommit, delay]);
  return <Input value={v} onChange={(e) => setV(e.target.value)} {...props} />;
}
