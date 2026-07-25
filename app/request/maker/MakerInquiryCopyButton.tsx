"use client";

import { useState } from "react";
import { WECHAT_ID } from "../../components/contact/WeChatContactCard";

type MakerInquiryCopyButtonProps = {
  makerName: string;
  makerType: string;
  makerRegion: string;
  makerPath: string;
};

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

export default function MakerInquiryCopyButton({
  makerName,
  makerType,
  makerRegion,
  makerPath,
}: MakerInquiryCopyButtonProps) {
  const [label, setLabel] = useState("复制咨询信息");

  async function handleCopy() {
    const makerUrl = `${window.location.origin}${makerPath}`;

    const message = [
      "【烟斗派斗师作品咨询】",
      "",
      `咨询对象：${makerName}`,
      `身份类型：${makerType}`,
      `工作地点：${makerRegion}`,
      `作品页面：${makerUrl}`,
      `联系微信：${WECHAT_ID}`,
      "",
      `我想咨询${makerName}的烟斗作品或定制方向。`,
    ].join("\n");

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(message);
      } else {
        fallbackCopy(message);
      }

      setLabel("已复制，可发送到微信");
    } catch {
      try {
        fallbackCopy(message);
        setLabel("已复制，可发送到微信");
      } catch {
        setLabel("复制失败，请长按复制");
      }
    }

    window.setTimeout(() => {
      setLabel("复制咨询信息");
    }, 2600);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="mt-5 flex h-[44px] w-full items-center justify-center rounded-[4px] bg-[var(--coffee-dark)] px-5 text-[13px] font-medium tracking-[0.02em] text-[#f7f1e8] transition-colors hover:bg-[var(--coffee)] active:bg-[#160d09]"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="mr-2 h-[16px] w-[16px]"
      >
        <rect
          x="8"
          y="8"
          width="10"
          height="11"
          rx="1.8"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M15 8V6.8A1.8 1.8 0 0 0 13.2 5H6.8A1.8 1.8 0 0 0 5 6.8v8.4A1.8 1.8 0 0 0 6.8 17H8"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>

      <span>{label}</span>
    </button>
  );
}
