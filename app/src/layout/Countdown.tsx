import type React from "react";
import { useEffect, useRef, useState } from "react";
import { getDaysHoursMinutesSeconds, getTimeLeftStr } from "@/utils/time";

interface CountdownProps {
  targetDate: Date;
  className?: string;
  timeDiff?: number; // Only used if the targetDate is from the server, and has not been adjusted for timeDiff already
  onFinish?: () => void;
  onEndShow?: React.ReactNode | string;
}

const Countdown: React.FC<CountdownProps> = (props) => {
  const { targetDate, timeDiff, onFinish, onEndShow, className } = props;

  // Calculate target time once per prop change
  const targetTime = targetDate.getTime() + (timeDiff ?? 0);

  // Track whether we've called onFinish for this countdown
  const hasCalledOnFinishRef = useRef(false);
  // Track the target time to detect when countdown resets
  const prevTargetTimeRef = useRef(targetTime);
  // Store onFinish in a ref to avoid it being a dependency (inline functions change every render)
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  // Reset finish flag when target changes
  if (prevTargetTimeRef.current !== targetTime) {
    prevTargetTimeRef.current = targetTime;
    hasCalledOnFinishRef.current = false;
  }

  const calcCountString = () => {
    const secondsLeft = targetTime - Date.now();
    const [days, hours, minutes, seconds] = getDaysHoursMinutesSeconds(secondsLeft);
    if (days + hours + minutes + seconds <= 0) {
      return "Done";
    }
    return getTimeLeftStr(days, hours, minutes, seconds);
  };

  const [countString, setCountString] = useState<string>(calcCountString);

  useEffect(() => {
    const updateCountdown = () => {
      const secondsLeft = targetTime - Date.now();
      const [days, hours, minutes, seconds] = getDaysHoursMinutesSeconds(secondsLeft);

      if (days + hours + minutes + seconds <= 0) {
        setCountString("Done");
        // Call onFinish only once per countdown
        if (onFinishRef.current && !hasCalledOnFinishRef.current) {
          hasCalledOnFinishRef.current = true;
          onFinishRef.current();
        }
        return true; // Signal countdown is done
      } else {
        setCountString(getTimeLeftStr(days, hours, minutes, seconds));
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
  }, [targetTime]);

  if (countString === "Done" && onEndShow) {
    return onEndShow;
  }
  return <span className={className}>{countString}</span>;
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
