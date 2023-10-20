import { Emotes } from "../../../../../common/src/definitions/emotes";
import { type SuroiBitStream } from "../../../../../common/src/utils/suroiBitStream";
import { enablePlayButton } from "../../main";
import { ReceivingPacket } from "../../types/receivingPacket";

export class JoinedPacket extends ReceivingPacket {
    override deserialize(stream: SuroiBitStream): void {
        if (this.game.socket.readyState === WebSocket.OPEN) {
            const emoteSelectors = [".emote-top", ".emote-right", ".emote-bottom", ".emote-left"];
            for (let i = 0; i < 4; i++) {
                $(`#emote-wheel > ${emoteSelectors[i]}`)
                    .css(
                        "background-image",
                        `url("./img/game/emotes/${Emotes.definitions[stream.readUint8()].idString}.svg")`
                    );
            }

            $("canvas").addClass("active");
            $("#splash-ui").fadeOut(enablePlayButton);
        }
    }
}
