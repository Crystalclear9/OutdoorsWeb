import { useEffect, useState } from "react";
import { dateString } from "./utils.js";

// The local date only triggers a fresh read; business status comes from the API.
export default function useBeijingDay() {
  const [day, setDay] = useState(dateString);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== "hidden") setDay(dateString());
    };
    const timer = setInterval(check, 30000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    check();
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return day;
}
