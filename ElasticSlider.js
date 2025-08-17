import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
} from "motion/react";
import React, { useEffect, useRef, useState } from "react";
import { RiVolumeDownFill, RiVolumeUpFill } from "react-icons/ri";

const MAX_OVERFLOW = 50;

export default function ElasticSlider({
  value,
  defaultValue = 50,
  min = 0,
  max = 100,
  className = "",
  isStepped = false,
  step = 1,
  leftIcon = React.createElement(RiVolumeDownFill, { className: "icon" }),
  rightIcon = React.createElement(RiVolumeUpFill, { className: "icon" }),
  onChange,
  valueFormatter
}) {
  return React.createElement(
    'div',
    { className: `slider-container ${className}` },
    React.createElement(Slider, {
      value,
      defaultValue,
      min,
      max,
      isStepped,
      step,
      leftIcon,
      rightIcon,
      onChange,
      valueFormatter
    })
  );
}

function Slider({
  value,
  defaultValue,
  min,
  max,
  isStepped,
  step,
  leftIcon,
  rightIcon,
  onChange,
  valueFormatter,
}) {
  const [internal, setInternal] = useState(
    typeof value === "number" ? value : defaultValue
  );
  const sliderRef = useRef(null);
  const [region, setRegion] = useState("middle");
  const clientX = useMotionValue(0);
  const overflow = useMotionValue(0);
  const scale = useMotionValue(1);

  useEffect(() => {
    if (typeof value === "number") setInternal(value);
  }, [value]);

  useEffect(() => {
    if (typeof value !== "number") setInternal(defaultValue);
  }, [defaultValue]);

  useMotionValueEvent(clientX, "change", (latest) => {
    if (sliderRef.current) {
      const { left, right } = sliderRef.current.getBoundingClientRect();
      let newValue;

      if (latest < left) {
        setRegion("left");
        newValue = left - latest;
      } else if (latest > right) {
        setRegion("right");
        newValue = latest - right;
      } else {
        setRegion("middle");
        newValue = 0;
      }

      overflow.jump(decay(newValue, MAX_OVERFLOW));
    }
  });

  const handlePointerMove = (e) => {
    if (e.buttons > 0 && sliderRef.current) {
      const { left, width } = sliderRef.current.getBoundingClientRect();
      let newValue = min + ((e.clientX - left) / width) * (max - min);

      if (isStepped) newValue = Math.round(newValue / step) * step;

      newValue = Math.min(Math.max(newValue, min), max);
      setInternal(newValue);
      onChange && onChange(newValue);
      clientX.jump(e.clientX);
    }
  };

  const handlePointerDown = (e) => {
    handlePointerMove(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerUp = () => {
    animate(overflow, 0, { type: "spring", bounce: 0.5 });
  };

  const getRangePercentage = () => {
    const totalRange = max - min;
    if (totalRange === 0) return 0;
    const val = typeof value === "number" ? value : internal;
    return ((val - min) / totalRange) * 100;
  };

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      motion.div,
      {
        onHoverStart: () => animate(scale, 1.2),
        onHoverEnd: () => animate(scale, 1),
        onTouchStart: () => animate(scale, 1.2),
        onTouchEnd: () => animate(scale, 1),
        style: {
          scale,
          opacity: useTransform(scale, [1, 1.2], [0.7, 1]),
        },
        className: "slider-wrapper",
      },
      React.createElement(
        motion.div,
        {
          animate: {
            scale: region === "left" ? [1, 1.4, 1] : 1,
            transition: { duration: 0.25 },
          },
          style: {
            x: useTransform(() =>
              region === "left" ? -overflow.get() / scale.get() : 0
            ),
          },
        },
        leftIcon
      ),
      React.createElement(
        'div',
        {
          ref: sliderRef,
          className: "slider-root",
          onPointerMove: handlePointerMove,
          onPointerDown: handlePointerDown,
          onPointerUp: handlePointerUp,
        },
        React.createElement(
          motion.div,
          {
            style: {
              scaleX: useTransform(() => {
                if (sliderRef.current) {
                  const { width } = sliderRef.current.getBoundingClientRect();
                  return 1 + overflow.get() / width;
                }
              }),
              scaleY: useTransform(overflow, [0, MAX_OVERFLOW], [1, 0.8]),
              transformOrigin: useTransform(() => {
                if (sliderRef.current) {
                  const { left, width } = sliderRef.current.getBoundingClientRect();
                  return clientX.get() < left + width / 2 ? "right" : "left";
                }
              }),
              height: useTransform(scale, [1, 1.2], [6, 12]),
              marginTop: useTransform(scale, [1, 1.2], [0, -3]),
              marginBottom: useTransform(scale, [1, 1.2], [0, -3]),
            },
            className: "slider-track-wrapper",
          },
          React.createElement(
            'div',
            { className: "slider-track" },
            React.createElement('div', {
              className: "slider-range",
              style: { width: `${getRangePercentage()}%` },
            })
          )
        )
      ),
      React.createElement(
        motion.div,
        {
          animate: {
            scale: region === "right" ? [1, 1.4, 1] : 1,
            transition: { duration: 0.25 },
          },
          style: {
            x: useTransform(() =>
              region === "right" ? overflow.get() / scale.get() : 0
            ),
          },
        },
        rightIcon
      )
    ),
    React.createElement(
      'p',
      { className: 'value-indicator' },
      typeof valueFormatter === 'function'
        ? valueFormatter(typeof value === 'number' ? value : internal)
        : Math.round(typeof value === 'number' ? value : internal)
    )
  );
}

function decay(value, max) {
  if (max === 0) {
    return 0;
  }

  const entry = value / max;
  const sigmoid = 2 * (1 / (1 + Math.exp(-entry)) - 0.5);

  return sigmoid * max;
}
