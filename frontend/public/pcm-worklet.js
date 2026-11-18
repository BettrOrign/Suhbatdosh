// Захват микрофона: Float32 -> Int16 PCM 16 kHz, блоками по 1024 сэмпла.
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const target = (options && options.processorOptions && options.processorOptions.targetRate) || 16000;
    this.ratio = sampleRate / target;
    this.input = [];
    this.phase = 0;
    this.out = new Int16Array(1024);
    this.outLen = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) this.input.push(channel[i]);

    while (this.phase + 1 < this.input.length) {
      const i0 = Math.floor(this.phase);
      const frac = this.phase - i0;
      const a = this.input[i0];
      const b = this.input[i0 + 1];
      let sample = a + (b - a) * frac;
      if (sample > 1) sample = 1;
      if (sample < -1) sample = -1;
      this.out[this.outLen++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

      if (this.outLen === this.out.length) {
        this.port.postMessage(this.out.buffer, [this.out.buffer]);
        this.out = new Int16Array(1024);
        this.outLen = 0;
      }
      this.phase += this.ratio;
    }

    const consumed = Math.floor(this.phase);
    if (consumed > 0) {
      this.input = this.input.slice(consumed);
      this.phase -= consumed;
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
