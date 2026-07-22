import { notFound } from "next/navigation";
import WallLabClient from "@/layout/WallLabClient";

export default function WallLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <WallLabClient />;
}
