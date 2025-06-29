import React, { useCallback } from "react";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormControl from "@mui/material/FormControl";
import FormLabel from "@mui/material/FormLabel";
import { useCameraDevice } from "@/module/camera";
import styled from "@emotion/styled";
import { CanvasId } from "@/store/ctx";

type Props = {
  id: CanvasId;
};

const StyledForm = styled(FormControl)`
  padding: 8px;
`;
const StyledRadio = styled(Radio)`
  padding: 2px;
`;

const CameraDeviceSelector: React.FC<Props> = (props) => {
  const [devices, deviceId, select] = useCameraDevice(props.id);
  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      select(e.target.value);
    },
    [select]
  );
  return (
    <StyledForm>
      <FormLabel>Camera Device</FormLabel>
      <RadioGroup value={deviceId} onChange={onChange}>
        {devices.map((device) => (
          <FormControlLabel
            control={<StyledRadio />}
            key={device.deviceId}
            value={device.deviceId}
            label={device.label}
          />
        ))}
      </RadioGroup>
    </StyledForm>
  );
};

export default CameraDeviceSelector;
