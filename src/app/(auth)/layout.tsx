/** Signed-out pages: no staff shell, centred on paper. */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="gutter flex flex-1 flex-col items-center justify-center py-[max(2.5rem,env(safe-area-inset-top))]">
      {children}
    </main>
  );
}
