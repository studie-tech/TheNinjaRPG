import React from "react";
import { useEffect, useState } from "react";
import { getDaysHoursMinutesSeconds, getTimeLeftStr } from "@/utils/time";

interface CountdownProps {
  targetDate: Date;
  className?: string;
  timeDiff?: number; // Only used if the targetDate is from the server, and has not been adjusted for timeDiff already
  // NOTE: Careful with this one to avoid infinite loop on re-render
  onFinish?: () => void;
  onEndShow?: React.ReactNode | string;
}

const Countdown: React.FC<CountdownProps> = (props) => {
  let targetTime = props.targetDate.getTime();
  if (props.timeDiff) {
    targetTime += props.timeDiff;
  }
  const [countDown, setCountDown] = useState(targetTime - new Date().getTime());
  const [countString, setCountString] = useState<string | null>(null);

  const updateString = (secondsLeft: number) => {
    const [days, hours, minutes, seconds] = getDaysHoursMinutesSeconds(secondsLeft);
    if (days + hours + minutes + seconds <= 0) {
      setCountString("Done");
    } else {
      setCountString(getTimeLeftStr(days, hours, minutes, seconds));
    }
  };

  useEffect(() => {
    const secondsLeft = targetTime - new Date().getTime();
    if (!countString) {
      updateString(secondsLeft);
    }
    if (secondsLeft > 0) {
      const interval = setInterval(() => {
        setCountDown(secondsLeft);
        updateString(secondsLeft);
      }, 500);
      return () => clearInterval(interval);
    } else {
      if (props.onFinish) {
        // NOTE: Careful with this one to avoid infinite loop on re-render
        props.onFinish();
      }
    }
  }, [countDown, countString, targetTime, props]);

  if (countString === "Done" && props.onEndShow) {
    return props.onEndShow;
  }
  return <span className={props.className}>{countString}</span>;
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
