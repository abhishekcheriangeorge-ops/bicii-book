"use client";

import { createContext } from "react";

/**
 * True inside a Sheet's body. The body is a clipping scroll container
 * (overflow-y-auto above a sticky footer), so an absolutely positioned popup
 * there adds no height and opens into hidden scroll space behind the footer
 * when the sheet is short. Popups read this and take space in the flow
 * instead (SearchPicker's results).
 */
export const InSheetBodyContext = createContext(false);
