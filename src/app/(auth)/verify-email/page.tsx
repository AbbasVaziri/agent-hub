import { Suspense } from "react";
import { VerifyEmailNotice } from "@/components/auth/forms";

export default function Page() {
  return (
    <Suspense>
      <VerifyEmailNotice />
    </Suspense>
  );
}
