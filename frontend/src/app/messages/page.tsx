import { Suspense } from "react";
import Inbox from "@/components/Inbox";
import { Spinner } from "@/components/ui";

export default function MessagesPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <Inbox scope="all" />
    </Suspense>
  );
}
