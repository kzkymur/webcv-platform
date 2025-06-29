import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import styled from "styled-components";
import { Button } from "@mui/material";
import { SetSendMsgSp } from "@/store/ctx/action";
import StorageJs from "@kzkymur/storage";
import { useStorageUnique } from "@kzkymur/storage/react";
import { NodeId } from "./Node";
import SelectBox from "../component/SelectBox";

type Props = {
  id: NodeId;
};

const baudRateList = [
  110, 300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200,
  128000, 256000,
] as const;

const StatusSentence = styled.span`
  padding: 16px 4px;
  display: block;
`;

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
`;

const storage = new StorageJs({
  name: "serial-device",
  storage: window.localStorage,
});
if (storage.get("baudRate").length === 0) storage.set({}, "baudRate");

const SerialDevice: React.FC<Props> = (props) => {
  const dispatch = useDispatch();
  const [port, setPort] = useState<null | SerialPort>(null);
  const [baudRate, setBaudRate] = useStorageUnique<number>(
    storage,
    `baudRate-id:${props.id}`
  );
  const changeBaudRate = useCallback(
    (v: string) => {
      setBaudRate(Number(v));
    },
    [setBaudRate]
  );
  const [deviceId, setDeviceId] = useState(0);
  const connect = useCallback(async () => {
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 });
      const id = port.getInfo().usbProductId;
      if (id === undefined) return;
      setDeviceId(id);
      setPort(port);
    } catch {
      // do nothing
    }
  }, []);
  const sendMessage = useMemo(
    () =>
      port === null || port.writable === null
        ? undefined
        : async (text: string) => {
          if (port === null || port.writable === null) return false;
          const encoder = new TextEncoder();
          const writer = port.writable.getWriter();
          await writer.write(encoder.encode(text + "\n"));
          writer.releaseLock();
          return true;
        },
    [port]
  );
  useEffect(() => {
    dispatch(SetSendMsgSp(props.id, sendMessage));
  }, [sendMessage]);
  return (
    <div>
      <StatusSentence>
        {deviceId === 0 ? (
          <span>unselected</span>
        ) : (
          <span>device id: {deviceId}</span>
        )}
      </StatusSentence>
      <Footer>
        <SelectBox
          onChange={changeBaudRate}
          value={String(baudRate)}
          values={baudRateList.map(String)}
          maxWidth={120}
          label="baud rate"
        />
        <Button variant="contained" onClick={connect}>
          Connect
        </Button>
      </Footer>
    </div>
  );
};

export default SerialDevice;
