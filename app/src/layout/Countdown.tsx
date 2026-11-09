import type React from "react";
import { useEffect, useRef, useState } from "react";
import { getTimeLeftStr } from "@/utils/time";

interface CountdownProps {
  targetDate: Date;
  className?: string;
  timeDiff?: number; // Only used if the targetDate is from the server, and has not been adjusted for timeDiff already
  onFinish?: () => void;
  onEndShow?: React.ReactNode | string;
  /** Replaces the default "X hours, Y mins" text with the given rendering of the ms left. */
  format?: (msLeft: number) => string;
}

/** Display a server-adjusted countdown and notify completion once per target date. */
const Countdown: React.FC<CountdownProps> = (props) => {
  const { targetDate, timeDiff, onFinish, onEndShow, className, format } = props;

  // Calculate target time once per prop change
  const targetTime = targetDate.getTime() + (timeDiff ?? 0);

  // Track whether we've called onFinish for this countdown
  const hasCalledOnFinishRef = useRef(false);
  // Track the actual target date to detect when countdown resets. `timeDiff` can
  // recalibrate without representing a new countdown.
  const targetDateTime = targetDate.getTime();
  const prevTargetDateTimeRef = useRef(targetDateTime);
  // Store onFinish in a ref to avoid it being a dependency (inline functions change every render)
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  // "Done" is decided on the raw millisecond remainder: the floored parts from
  // getDaysHoursMinutesSeconds sum to 0 while up to 999 ms remain, which would fire
  // onFinish before the server-side deadline (e.g. quest collect timers).
  const calcCountString = () => {
    const msLeft = targetTime - Date.now();
    if (msLeft <= 0) {
      return "Done";
    }
    if (format) return format(msLeft);
    return getTimeLeftStr(msLeft);
  };

  const labelRef = useRef<HTMLSpanElement>(null);
  const [isFinished, setFinished] = useState(() => targetTime <= Date.now());
  const finishedRef = useRef(isFinished);

  useEffect(() => {
    // Clock recalibration keeps the same countdown; only a new deadline can finish again.
    if (prevTargetDateTimeRef.current !== targetDateTime) {
      prevTargetDateTimeRef.current = targetDateTime;
      hasCalledOnFinishRef.current = false;
    }
    const updateCountdown = () => {
      const msLeft = targetTime - Date.now();
      const finished = msLeft <= 0;
      // Clock text has one DOM owner; only terminal UI changes need React reconciliation.
      const label = labelRef.current;
      const text = calcCountString();
      if (label && label.textContent !== text) label.textContent = text;
      if (finishedRef.current !== finished) {
        finishedRef.current = finished;
        setFinished(finished);
      }
      if (finished) {
        // Call onFinish only once per countdown
        if (onFinishRef.current && !hasCalledOnFinishRef.current) {
          hasCalledOnFinishRef.current = true;
          onFinishRef.current();
        }
        return true; // Signal countdown is done
      } else {
        return false;
      }
    };

    // Initial update - check if already done
    const isDone = updateCountdown();

    // Only set up interval if not already done
    if (!isDone) {
      const interval = setInterval(() => {
        const nowDone = updateCountdown();
        if (nowDone) {
          clearInterval(interval);
        }
      }, 500);
      return () => clearInterval(interval);
    }
  }, [targetTime, targetDateTime]);

  if (isFinished && onEndShow) {
    return onEndShow;
  }
  // The server's string is whatever the clock said when the page was rendered, which
  // for a prerendered page is the build. The effect above replaces it on mount, so the
  // mismatch is the one React allows a timestamp to have.
  return (
    <span ref={labelRef} className={className} suppressHydrationWarning>
      {calcCountString()}
    </span>
  );
};

export default Countdown;

/**
 * Timer gradually going up
 * @param createdAt - The date the timer was created
 * @returns The timer component
 */
export const QueueTimer = ({ createdAt }: { createdAt: Date }) => {
  const [queueTime, setQueueTime] = useState("0:00");

  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const diff = now.getTime() - new Date(createdAt).getTime();
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setQueueTime(`${minutes}:${seconds.toString().padStart(2, "0")}`);
    };

    updateTimer(); // Initial update
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [createdAt]);

  return <span className="font-mono">{queueTime}</span>;
};
