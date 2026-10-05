"use client";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchIcon } from "@/components/ui/icons";

export function SearchBox() {
  return (
    <form role="search" onSubmit={(e) => e.preventDefault()}>
      <Field label="Search" hideLabel hint="Name, phone, email, serial number, job or short ID">
        <Input
          type="search"
          name="q"
          autoFocus
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Search"
          prefix={<SearchIcon className="size-5" />}
        />
      </Field>
    </form>
  );
}
