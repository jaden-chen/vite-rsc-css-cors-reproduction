"use client";

import { lazy, Suspense, useEffect, useState } from "react";

const Card = lazy(() => import("../card"));

export default function Loader() {
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => setReady(true), []);

  return (
    <>
      <button disabled={!ready} onClick={() => setVisible(true)}>
        Show card
      </button>
      <Suspense fallback={<p>Loading card</p>}>{visible && <Card />}</Suspense>
    </>
  );
}
