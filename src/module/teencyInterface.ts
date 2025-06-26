import { WriteSerialPort } from "@/store/ctx";
import { crampGalvoCoordinate, GALVO_MAX_X, GALVO_MAX_Y } from "@/util/calcHomography";

type Coordinate = {
  x: number;
  y: number;
};

class TeencyCommunicator {
  private send: WriteSerialPort;
  constructor(writeSerialPort: WriteSerialPort) {
    this.send = writeSerialPort;
  }
  public setLaserOutput = (output: number) => {
    this.send(`A${Math.floor(output)}`);
  };
  public setGalvoPos = (coordinate: Coordinate) => {
    console.log(coordinate);
    const calibratedCoordinate = crampGalvoCoordinate({
      x: (coordinate.x + GALVO_MAX_X / 2 + 1) % (GALVO_MAX_X + 1),
      y: (coordinate.y + GALVO_MAX_Y / 2 + 1) % (GALVO_MAX_Y + 1),
    });
    this.send(`B${Math.floor(calibratedCoordinate.x)},${Math.floor(calibratedCoordinate.y)}`);
  };
}

export default TeencyCommunicator;
