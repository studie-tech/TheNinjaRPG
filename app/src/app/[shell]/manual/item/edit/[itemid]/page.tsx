"use client";

import { use } from "react";
import { ItemEditScreen } from "@/screens/manual/item/edit/ItemEditScreen";

export default function ItemEdit(props: { params: Promise<{ itemid: string }> }) {
  return <ItemEditScreen params={use(props.params)} />;
}
