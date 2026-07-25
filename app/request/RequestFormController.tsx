"use client";

import { useEffect } from "react";

const WECHAT_ID = "zr610944194";

function fieldValue(
  form: HTMLFormElement,
  name: string,
  fallback = "未填写"
) {
  const value = String(
    new FormData(form).get(name) || ""
  ).trim();

  return value || fallback;
}

function fallbackCopy(text: string) {
  const textarea = document.createElement("textarea");

  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("copy-command-failed");
  }
}

function buildMessage(form: HTMLFormElement) {
  return [
    "【烟斗派找斗需求】",
    "",
    `预算范围：${fieldValue(form, "budget")}`,
    `新斗 / 回流：${fieldValue(form, "condition")}`,
    `品牌偏好：${fieldValue(
      form,
      "brand",
      "没有明确偏好"
    )}`,
    `斗型偏好：${fieldValue(
      form,
      "shape",
      "没有明确偏好"
    )}`,
    `重量偏好：${fieldValue(form, "weight")}`,
    `滤芯偏好：${fieldValue(form, "filter")}`,
    `使用经验：${fieldValue(form, "experience")}`,
    `使用侧重：${fieldValue(form, "priority")}`,
    `补充说明：${fieldValue(form, "note", "无")}`,
    `联系微信：${WECHAT_ID}`,
    "",
    "请根据以上需求推荐合适的烟斗，并人工确认当前库存、参考价格、国际运费及预计税费。",
  ].join("\n");
}

export default function RequestFormController() {
  useEffect(() => {
    const form = document.getElementById(
      "pipe-request-form"
    ) as HTMLFormElement | null;

    const label = document.getElementById(
      "copy-pipe-request-label"
    );

    const result = document.getElementById(
      "pipe-request-result"
    );

    const preview = document.getElementById(
      "pipe-request-preview"
    );

    if (!form || !label || !result || !preview) {
      return;
    }

    const handleSubmit = async (event: SubmitEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (!form.reportValidity()) {
        return;
      }

      const message = buildMessage(form);

      preview.textContent = message;
      result.classList.remove("hidden");

      try {
        if (
          navigator.clipboard &&
          window.isSecureContext
        ) {
          await navigator.clipboard.writeText(message);
        } else {
          fallbackCopy(message);
        }

        label.textContent =
          "已复制，可发送到微信";
      } catch {
        try {
          fallbackCopy(message);
          label.textContent =
            "已复制，可发送到微信";
        } catch {
          label.textContent =
            "复制失败，请长按复制摘要";
        }
      }

      result.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });

      window.setTimeout(() => {
        label.textContent =
          "生成并复制找斗需求";
      }, 2600);
    };

    form.addEventListener(
      "submit",
      handleSubmit,
      true
    );

    return () => {
      form.removeEventListener(
        "submit",
        handleSubmit,
        true
      );
    };
  }, []);

  return null;
}
