/**
 * One page of a list (customers, bikes, search): at most the limit asked
 * for, and `more` when there were more matches than that, so a screen can
 * say the list is cut off instead of presenting it as complete.
 */
export type ListPage<T> = { items: T[]; more: boolean };
